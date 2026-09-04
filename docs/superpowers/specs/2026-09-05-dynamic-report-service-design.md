# 动态报表生成服务 设计文档

- 日期：2026-09-05
- 状态：待评审
- 技术栈：Golang + excelize + 自研规则引擎

## 1. 背景与目标

传统 Excel 模板无法适配"维度数量不定"与"复杂视觉样式"两类痛点。本服务基于 Golang 构建动态报表生成能力：

1. **动态结构渲染**：支持 0..N 个 GroupBy 维度，自动处理层级缩进与合并单元格；自动插入分组小计与总计行，公式动态生成（真实 Excel 公式，非预计算值）。
2. **位置/语义驱动的复杂样式**：边框支持"外粗内细"等基于坐标位置的动态计算；斑马纹基于"分组内逻辑序号"而非全局物理行号；样式解耦为"模板管字体/数字格式、规则引擎管布局样式"。
3. **排序与配置化**：维度排序由元数据 `sort_key` 驱动；样式规则 JSON 配置化，存 DB、管理端发布、热更新，无硬编码。
4. **美观优先**：本项目的核心价值是让导出 Excel 直接可用于汇报。数据值驱动样式、列宽自适应、冻结窗格、打印友好等美学能力为一等公民。
5. **深度可交互预览**：以统一的 `RenderSchema` 作为预览与导出的单一事实源，前端可解释样式成因、追溯数据统计来源、在预览上直接调整单元格样式。

### 明确的范围边界

- **数据处理与安全不在本服务范围**：由前置数据处理项目负责（含数据源安全、字段权限等）。
- **交付形态**：高保真 Excel 导出为主，Web 预览为辅（预览服务于配置交互）。
- **并发预期**：用户接受异步导出与较慢的生成速度，换取完整样式能力与实现简单性。

## 2. 关键决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | 数据链路 | 服务直连可配置数据源（DB/Excel/CSV/JSON），聚合在 Go 内存完成 | 维度组合任意，预聚合不可行 |
| D2 | 渲染管道 | **纯物化，单模式，不保留流式兜底** | 用户确认数据量可控、接受异步；物化模式解锁全部样式能力（全局视野规则、列宽精确自适应、总计置顶等），一条管道一种心智 |
| D3 | 规模边界 | 布局行数硬上限（默认 10 万行，可配），提交前预估，超限拒绝 | 以明确拒绝替代流式降级，诚实且简单；进度可精确到百分比 |
| D4 | 公式策略 | `SUBTOTAL` 函数族，嵌套小计天然不重复求值；公式+缓存值双写 | 动态公式且任何消费方打开即有值 |
| D5 | 值驱动样式 | 双轨：渲染期规则求值（阈值类）+ 原生条件格式（Top-N/数据条/色阶/图标集） | 后者只有 Excel 原生条件格式能做，且数据变更后样式仍正确 |
| D6 | 配置分发 | 报表定义存 DB、版本化、管理端发布、服务缓存刷新（事件+TTL 双保险） | 高频配置变更需要版本管理与审计 |
| D7 | 预览一致性 | `RenderSchema` 单一事实源，Excel 渲染器与预览渲染器同消费 | 预览与导出永不漂移 |
| D8 | 单元格手工调整 | 语义锚定 override（锚定分组路径/行类型/指标，而非物理坐标） | 维度变更后调整仍命中正确位置 |

## 3. 总体架构

```
┌─ api ──────────────────────────────────────────────────────────────┐
│  导出任务 API │ 预览/交互 API │ 管理端：定义编辑/发布/版本          │
└──────────────────────────┬─────────────────────────────────────────┘
                           ▼
                 orchestrator（任务编排：预估→准入→快照绑定→管道→产物）
     ┌──────────┬──────────┼───────────────┬──────────────┐
     ▼          ▼          ▼               ▼              ▼
  catalog    datahub     engine          style          render
  定义存储    数据源适配   GroupStack聚合   规则引擎        ExcelizeRenderer
  版本/发布   DB/Excel/   →布局物化        DSL求值         列宽/合并/冻结
  本地缓存    CSV/JSON    →三遍布局处理    →样式字典        条件格式/打印
     │                      │               │              │
     │                      ▼               └──────┬───────┘
     │                 LayoutStore                 ▼
     │                 （物化布局行）          RenderSchema
     │                                      ┌──────┴───────┐
     │                                      ▼              ▼
     │                                 .xlsx 导出     预览渲染器(分页)
     └──────────────────────────────────────┬──────────────┘
                                            ▼
                              preview：样式解释 / 数据血缘 / override 写回
```

### 包划分（单一职责，接口隔离）

| 包 | 职责 | 关键接口 |
|---|---|---|
| `catalog` | 报表定义存取、版本、草稿/发布、发布通知、进程内缓存 | `Get(id, version) (ReportDefinition, error)` |
| `datahub` | 数据源适配，产出按排序键有序的行流；文件源外排序 | `Source.Open(ctx, ds) (OrderedRows, error)` |
| `engine` | GroupStack 聚合、布局物化、三遍布局处理、公式区间登记、trace 收集 | `Build(ctx, def) (*Layout, error)` |
| `style` | DSL 解析/校验、条件求值、位置谓词解析、样式合并与字典化 | `Engine.Resolve(ctx CellContext) (styleID, []RuleHit)` |
| `schema` | RenderSchema 定义、样式字典去重、分页、序列化 | `Build(layout) *RenderSchema` |
| `render` | excelize 落盘：列宽、合并、公式、条件格式、冻结、打印设置 | `Render(schema, w io.Writer) error` |
| `preview` | 预览分片、样式解释、数据血缘、override 管理 | HTTP handlers |
| `orchestrator` | 任务生命周期：预估、内存准入、队列、进度、产物落地 | `Submit(req) (taskID, error)` |

### 核心数据流

```
导出任务提交 → 行数预估（维度组合基数采样）→ 超限拒绝 / 准入排队
→ 绑定定义版本快照 → datahub 有序明细流（DB: ORDER BY 下推；文件: 外排序归并）
→ GroupStack 滚动聚合 → LayoutStore 物化布局行
→ P1 位置遍（组边界/序号/合并跨度/列宽统计/组内排名）
→ P2 样式遍（逐单元格 CellContext → 规则求值 → 样式ID）
→ P3 装配遍（override 叠加 → 公式+缓存值 → 条件格式区间 → 页面设置）
→ RenderSchema → ExcelizeRenderer → .xlsx（产物落存储，返回下载）
```

预览请求走同一管道至 RenderSchema 后分叉为分页 JSON 输出。

## 4. 核心数据模型

报表定义（`ReportDefinition`）存 DB，JSON 序列化，带版本号；草稿与发布分离，导出只消费已发布版本。

```jsonc
{
  "id": "rpt_sales", "version": 17, "status": "published", "name": "销售动态报表",
  "dataset": {
    "source_ref": "mysql_bi",                 // 数据源引用（连接信息由前置项目托管）
    "table": "sales_detail",
    "row_cap": 100000,                         // 布局行硬上限，可覆盖全局默认
    "fields": [
      {"key": "region", "type": "string", "sort_key": "region_order"},
      {"key": "city",   "type": "string", "sort_key": "city_order"},
      {"key": "amount", "type": "number"},
      {"key": "qty",    "type": "number"}
    ]
  },
  "dimensions": [                              // 数量不定，0..N
    {"field": "region", "label": "大区", "sort": {"by": "sort_key", "dir": "asc"}},
    {"field": "city",   "label": "城市", "sort": {"by": "value",    "dir": "desc"}}
  ],
  "metrics": [
    {"field": "amount", "label": "销售额", "agg": "SUM",   "num_fmt_ref": "money"},
    {"field": "qty",    "label": "件数",   "agg": "COUNT", "num_fmt_ref": "int"}
  ],
  "layout_opts": {
    "total_position": "bottom",                // bottom | top（top 依赖物化，已支持）
    "freeze": {"rows": 1, "cols": 1},
    "print": {"orientation": "landscape", "fit_to_width": 1, "repeat_header_rows": 1}
  },
  "template_ref": "tpl_finance_v3.xlsx",       // 基础样式：字体/数字格式/表头
  "style_rules": { /* 见第 5 节 DSL */ },
  "overrides": [ /* 见第 10 节语义锚定 override */ ],
  "conditional_formats": [ /* 见第 9 节轨道 B */ ]
}
```

要点：

- `dimensions` 为变长数组，支撑"维度数量不定"；`sort.by` 支持 `sort_key`（元数据驱动）与 `value`（值本身），由管理端结构化排序面板维护。
- `num_fmt_ref` 引用模板内命名数字格式；规则引擎不得改写字体与数字格式（发布期 schema 强制）。
- 文件类数据源（Excel/CSV/JSON）复用同一模型，`dataset.source_ref` 指向文件源注册项。

## 5. 样式规则 DSL

### 5.1 设计原则

1. `when` 描述语义/位置条件，`style` 只表达布局属性（边框、底色、缩进、加粗、行高）；字体与数字格式归模板。
2. 条件 = 布尔组合（`all/any/not`）+ 原子谓词；原子谓词对 `CellContext` 字段求值。
3. 边框支持位置谓词 `at` 子句，把"外粗内细"这类规则表达为声明而非坐标硬编码。
4. 规则按 `priority` 升序叠加，属性级合并；全部规则在发布期做 schema 校验与样例数据 dry-run。

### 5.2 完整示例

```jsonc
{
  "version": 1,
  "rules": [
    {
      "id": "outer-thick-inner-thin",
      "priority": 100,
      "when": {"all": [{"ctx": "row_type", "in": ["detail", "subtotal"]}]},
      "style": {
        "border": {
          "top":    {"at": "group_first_row", "style": "medium", "else": "hair"},
          "bottom": {"at": "group_last_row",  "style": "medium", "else": "hair"},
          "left":   {"at": "group_first_col", "style": "medium", "else": "hair"},
          "right":  {"at": "group_last_col",  "style": "medium", "else": "hair"}
        }
      }
    },
    {
      "id": "zebra-in-group",
      "priority": 50,
      "when": {"all": [
        {"ctx": "row_type", "eq": "detail"},
        {"ctx": "seq_in_group", "mod": 2, "eq": 0}
      ]},
      "style": {"fill": {"color": "#F5F7FA"}}
    },
    {
      "id": "subtotal-emphasis",
      "priority": 120,
      "when": {"ctx": "row_type", "eq": "subtotal"},
      "style": {"fill": {"color": "#E8EEF7"}, "bold": true, "row_height": 22}
    },
    {
      "id": "negative-red",
      "priority": 200,
      "when": {"all": [
        {"ctx": "col_role", "eq": "metric"},
        {"ctx": "value", "op": "lt", "value": 0}
      ]},
      "style": {"font_color": "#C0392B"}
    },
    {
      "id": "depth-indent",
      "priority": 30,
      "when": {"all": [
        {"ctx": "col_role", "eq": "dimension"},
        {"ctx": "dim_depth", "op": "gte", "value": 1}
      ]},
      "style": {"indent": {"expr": "dim_depth"}}
    }
  ]
}
```

### 5.3 条件谓词

组合器：`all`、`any`、`not`（嵌套任意深度）。原子谓词字段：

| ctx 字段 | 类型 | 说明 |
|---|---|---|
| `row_type` | enum | header / detail / subtotal / total |
| `col_role` | enum | dimension / metric |
| `dim_depth` | int | 维度列层级（0-based） |
| `seq_in_group` | int | 组内逻辑序号（1-based，每组重计） |
| `group_path` | []string | 分组路径，支持前缀匹配 |
| `metric_key` / `dim_key` | string | 当前列绑定的指标/维度字段 |
| `value` | any | 单元格数据值（数值比较/区间/集合） |
| `is_group_first_row` 等 | bool | 位置标志（P1 位置遍写入） |

操作符：`eq / ne / in / gt / gte / lt / lte / between / mod+eq / odd / even / prefix`。

### 5.4 边框位置谓词（at 子句）

`at` 取值：`group_first_row / group_last_row / group_first_col / group_last_col / sheet_first_row / sheet_last_row / always`。物化模式下位置标志在 P1 位置遍一次性算出，求值即查表，无需前瞻。线型枚举：`hair / thin / medium / thick / double / dashed`。

### 5.5 冲突解决与校验

- 按 `priority` 升序逐条叠加：边框按边合并，底色/缩进/行高取高优先级整体替换，加粗取或。
- 发布期校验：schema 合法性、样式属性越权（禁改字体/数字格式）、样例数据 dry-run 输出命中统计。
- 运行时样式字典化：相同样式结果的单元格共享 `styleID`（见第 7 节）。

### 5.6 值驱动样式的双轨边界

- **轨道 A（本 DSL）**：写出时刻可判定的规则（阈值、区间、奇偶、与常量比较），样式直接写入单元格。
- **轨道 B（原生条件格式）**：组内/全局 Top-N、数据条、色阶、图标集，见第 9 节。
- 已知取舍：不做"渲染期回溯改已定样式"；需要未来信息的视觉语义一律走轨道 B。

## 6. CellContext 上下文结构

规则引擎的唯一求值输入，由管道在求值前完整填充。"位置"与"语义"分离：语义字段由聚合阶段写入，位置标志由 P1 位置遍写入。

```go
package style

type RowType uint8

const (
    RowHeader RowType = iota
    RowDetail
    RowSubtotal
    RowTotal
)

type ColRole uint8

const (
    ColDimension ColRole = iota
    ColMetric
)

// CellContext 是规则引擎的唯一求值输入；所有字段在求值前由管道填充完整。
type CellContext struct {
    // 坐标与角色
    Row, Col int      // 物理坐标（1-based）
    RowType  RowType
    ColRole  ColRole
    DimDepth int      // 维度列层级（0-based）；指标列为 -1

    // 分组语义
    GroupPath  []string // 当前分组路径，如 ["华东","上海"]
    SeqInGroup int      // 明细行在最内层组内的逻辑序号（1-based）

    // 位置标志（P1 位置遍写入，物化模式下全局已知）
    GroupFirstRow bool
    GroupLastRow  bool
    GroupFirstCol bool
    GroupLastCol  bool
    SheetFirstRow bool
    SheetLastRow  bool

    // 数据与公式
    Value    any
    Metric   *MetricDef  // ColRole == ColMetric 时的指标定义（含聚合函数）
    SubRange *SubRange   // RowType 为 Subtotal/Total 时的公式引用区间
}

// SubRange 描述小计/总计公式引用的行区间。
type SubRange struct {
    FromRow, ToRow int    // 物理行号（含）
    ColLetter      string // 指标列字母，如 "B"
}
```

规则作者只声明"在组末行用粗线"这类语义，不感知位置标志如何计算。

## 7. 布局物化管道

### 7.1 GroupStack 与布局物化

明细按排序键有序流入（DB 源 `ORDER BY` 下推；文件源分块外排序后多路归并）。`GroupStack` 维护打开的分组栈，逐行滚动推进；布局行（含小计）物化进 `LayoutStore`。内存占用 O(布局行数)，受行数上限约束。

```go
package engine

// LayoutRow 是物化布局的一行；样式与公式在后续遍中填充。
type LayoutRow struct {
    Type       RowType
    Level      int        // subtotal 的层级（对应维度序号）；其他为 -1
    GroupPath  []string   // 归属分组路径
    SeqInGroup int        // detail 行的组内逻辑序号
    Cells      []LayoutCell
}

type LayoutCell struct {
    Value     any    // 维度值或指标缓存值
    Formula   string // P3 装配遍填充
    StyleID   int    // P2 样式遍填充
    RuleHits  []string
}

// GroupStack 消费有序明细流，产出物化布局。
type GroupStack struct {
    dims    []DimensionDef
    metrics []MetricDef
    stack   []*groupState
    layout  *LayoutStore
    rowNo   int // 当前物理行号（含表头偏移）
}

type groupState struct {
    depth    int
    key      string
    startRow int          // 组内第一个数据行的物理行号
    aggs     []Aggregator // 每指标一个增量聚合器（提供缓存值）
}

// Feed 处理一条有序明细行：闭合变浅的分组（自底向上弹出小计行），
// 打开新分组，追加明细行。
func (g *GroupStack) Feed(r DetailRow) error {
    keys := r.GroupKeys(g.dims)
    lcp := commonPrefixLen(g.currentPath(), keys)

    // 自底向上闭合分组，弹出小计行
    for len(g.stack) > lcp {
        if err := g.closeTopGroup(); err != nil {
            return err
        }
    }
    // 打开新分组
    for d := lcp; d < len(keys); d++ {
        g.stack = append(g.stack, &groupState{
            depth: d, key: keys[d], startRow: g.rowNo + 1,
            aggs:  newAggregators(g.metrics),
        })
    }
    // 追加明细行并更新各层聚合器
    row := g.buildDetailRow(r)
    for _, gs := range g.stack {
        gs.aggs.Update(g.metrics, r)
    }
    g.layout.Append(row)
    g.rowNo++
    return nil
}

// closeTopGroup 弹出栈顶分组：写小计行，公式区间此刻已知。
func (g *GroupStack) closeTopGroup() error {
    gs := g.stack[len(g.stack)-1]
    g.stack = g.stack[:len(g.stack)-1]
    row := g.buildSubtotalRow(gs, g.rowNo) // FromRow=gs.startRow, ToRow=g.rowNo
    g.layout.Append(row)
    g.rowNo++
    return nil
}

// Finish 闭合剩余分组并写总计行（总计位置由 layout_opts 决定）。
func (g *GroupStack) Finish() error { /* 略：逐个 closeTopGroup 后写 total 行 */ }
```

### 7.2 三遍布局处理

| 遍 | 输入 | 输出 |
|---|---|---|
| P1 位置遍 | 布局行序列 | 组边界（first/last row/col）、`seq_in_group`、合并跨度、列宽统计（显示宽度，CJK 计 2）、组内排名（供 Top-N） |
| P2 样式遍 | 位置遍结果 + 规则集 | 逐单元格构建 `CellContext` → `StyleEngine.Resolve` → `styleID` + `RuleHits`；相同结果字典去重 |
| P3 装配遍 | 样式遍结果 + override + 模板 | override 叠加、公式+缓存值填充、条件格式区间生成、冻结/打印/网格线设置 |

```go
// StyleEngine.Resolve 求值全部规则并合并样式（预览模式开启 trace 记录 RuleHits）。
func (e *StyleEngine) Resolve(ctx *style.CellContext, trace bool) (int, []string) {
    merged := e.base.Clone(ctx) // 模板基础样式（字体/数字格式/对齐）
    var hits []string
    for _, r := range e.rules { // 已按 priority 升序
        if !r.When.Eval(ctx) {
            continue
        }
        merged.ApplyLayout(r.Style, ctx) // 只叠加布局属性
        if trace {
            hits = append(hits, r.ID)
        }
    }
    return e.dict.Intern(merged), hits // 字典化：相同样式共享 ID
}
```

### 7.3 行数上限与内存准入

- 任务提交时对数据集做基数预估（`COUNT(DISTINCT 维度组合)` 采样 + 明细行数），布局行预估超过 `row_cap` 直接拒绝并给出收窄建议。
- 任务队列按"预估布局行 × 单行内存系数"做准入，保证并发任务总内存在预算内。
- 布局行总数在渲染前已知，导出进度可精确到百分比。

## 8. 公式引擎

### 8.1 SUBTOTAL 策略

所有小计/总计统一使用 `SUBTOTAL` 函数族：其天然忽略区间内嵌套的 `SUBTOTAL` 行，多级小计不重复求值，总计可直接引用全区间。

| 聚合函数 | SUBTOTAL 码 |
|---|---|
| SUM | 9 |
| AVERAGE | 1 |
| COUNT | 3（COUNTA 语义：非空计数） |
| MAX | 4 |
| MIN | 5 |

### 8.2 公式与缓存值双写

聚合器在物化阶段已算出精确值；写公式的同时写入缓存值，保证 pandas 等不重算公式的消费方打开即有值。是否输出公式本身可配置（`formula_strategy: formula|value`）。

```go
package engine

func SubtotalFormula(agg AggFunc, col string, from, to int) string {
    fn := map[AggFunc]int{
        AggSum: 9, AggAvg: 1, AggCount: 3, AggMax: 4, AggMin: 5,
    }[agg]
    return fmt.Sprintf("=SUBTOTAL(%d,%s%d:%s%d)", fn, col, from, col, to)
}

// 总计：0 维度时对明细区间求聚合；有维度时对全区间用 SUBTOTAL
// （自动忽略各级小计行）。公式与缓存值由 Aggregator 快照提供。
```

### 8.3 派生指标（P2 预留）

占比/环比等跨指标公式（如 `=B5/C5`）预留 `FormulaBuilder` 扩展点：受限表达式树（白名单算子 + 指标引用），与小计公式共用装配遍填充流程。v1 不实现。

## 9. 值驱动样式轨道 B：原生条件格式

组内/全局 Top-N、数据条、色阶、图标集，通过 Excel 原生条件格式实现：渲染完成后向 Sheet 注入 `conditionalFormatting` 规则，由 Excel 打开时动态求值；用户后续改动数据样式依然正确。

```jsonc
// ReportDefinition.conditional_formats 示例
[
  {"id": "cf_amount_databar", "scope": {"metric": "amount"},
   "kind": "data_bar", "color": "#638EC6"},
  {"id": "cf_top3_in_group", "scope": {"metric": "amount", "per_group": true},
   "kind": "top_n", "n": 3, "style": {"fill": "#FDEBD0", "bold": true}}
]
```

规则说明：

- `scope` 语义化：指标列 + 可选 `per_group`。P3 装配遍把语义作用域展开为物理区间集合（每组一条规则）。
- 分组数超阈值（默认 200）时自动降级为全局作用域并记录告警，避免条件格式条目爆炸。
- Schema 中的条件格式条目携带作用域的列级统计（`stats: {min, max}`）与 Top-N 命中行集合，供预览端模拟（见第 16.4 节），前端不重复统计。
- 预览端用等价 JS/CSS 模拟数据条与色阶；模拟保真度见风险 R2。

## 10. 语义锚定 Override（预览直改样式）

用户在预览中调整单元格样式时，生成写入报表定义的 override。不锚定物理坐标，锚定语义坐标，维度增删/重排后仍命中正确位置。

```jsonc
{
  "id": "ov_1",
  "scope": {
    "group_path_prefix": ["华东"],      // 可省略 = 全部
    "row_type": "subtotal",             // detail | subtotal | total
    "metric": "amount",                 // 或 "dim": "region"
    "cell_match": "value_eq:小计"        // 可选的进一步过滤
  },
  "style_patch": {"fill": {"color": "#FFF7E6"}, "bold": true},
  "created_from": {"session": "s123", "cell_id": "r5c1"}
}
```

- 渲染优先级：`override > 规则 DSL > 模板基础样式`。
- override 可修改任意呈现属性（含字体颜色/加粗/数字格式），属于"最高优先级手工补丁"，不破坏三级来源的解耦原则。
- 发布期检测**悬空 override**（命中 0 单元格）并告警，由用户确认保留或删除。
- 样式解释面板中，override 与规则一同列出于命中列表，标注来源为"手工调整"。

## 11. RenderSchema 契约

预览与导出的单一事实源：前端渲染表格、后端写 Excel、交互追溯，全部消费同一结构。

### 11.1 结构

```jsonc
{
  "schema_version": 1,
  "report": {"id": "rpt_sales", "def_version": 17, "row_total": 1240},
  "cols": [
    {"idx": 0, "role": "dimension", "depth": 0, "label": "大区", "width": 14, "align": "left"},
    {"idx": 1, "role": "metric", "metric": "amount", "label": "销售额",
     "num_fmt": "#,##0.00", "width": 12, "align": "right"}
  ],
  "styles": {                       // 样式字典：去重，单元格只引用
    "s12": {"border": {"top": "hair", "bottom": "medium", "left": "medium", "right": "hair"},
            "fill": "#F5F7FA", "indent": 0},
    "s13": {"fill": "#E8EEF7", "bold": true}
  },
  "merges": [{"r1": 2, "r2": 5, "c": 0}],
  "freeze": {"rows": 1, "cols": 1},
  "rows": [
    {"idx": 2, "type": "detail", "group_path": ["华东"], "seq": 1,
     "cells": [
       {"col": 0, "cell_id": "r2c0", "value": "华东", "style": "s12",
        "rule_hits": ["outer-thick-inner-thin", "zebra-in-group"]},
       {"col": 1, "cell_id": "r2c1", "value": 12500.5, "display": "12,500.50", "style": "s12"}
     ]},
    {"idx": 5, "type": "subtotal", "group_path": ["华东"], "height": 22,
     "cells": [{"col": 1, "cell_id": "r5c1", "formula": "=SUBTOTAL(9,B2:B4)",
                "value": 38000.2, "display": "38,000.20", "style": "s13",
                "rule_hits": ["subtotal-emphasis"]}]}
  ],
  "conditional_formats": [ /* 轨道 B 展开后的区间规则 */ ],
  "page_setup": {"orientation": "landscape", "fit_to_width": 1, "gridlines": false}
}
```

### 11.2 契约治理

- `schema_version` 显式演进；破坏性变更走双版本过渡期。
- **契约测试固化**：后端维护样例 Schema 黄金文件，前端 CI 拉取解析断言，防止互相卡死。
- `rule_hits` 仅在预览模式（trace 开启）产出；导出路径不承担该开销。

### 11.3 体积防护

- 骨架（列/合并/样式字典/页面设置）一次返回；行数据按窗口分页（`?from=&to=`），前端虚拟滚动。
- 单元格只持样式字典 ID；trace 类信息懒加载（见第 12 节）。

## 12. 预览与深度交互

### 12.1 三类交互及其支撑字段

1. **样式可解释（为什么是这个样式）**：点击单元格弹出解释面板，列出 `rule_hits` 及每条规则的求值轨迹（"命中 zebra-in-group，因为组内序号=2（偶数）"）。由规则引擎的 trace 开关支撑。
2. **数据可追溯（数据怎么统计来的）**：明细单元格返回来源行数与主键抽样；小计/总计返回公式、引用区间、子聚合项。聚合遍顺带收集（计数+抽样，不存全量主键）。懒加载。
3. **预览直改样式**：生成语义锚定 override（第 10 节）；改规则/override 后只重算命中范围，保持秒级交互。

### 12.2 API

```
POST /v1/render                        {def_id, version?, dataset: sample|full,
                                        row_window:{from,to}, dirty_rules?}
                                       → RenderSchema 分片（预览模式，trace 开启；
                                         dataset=sample 即快速样例渲染）
GET  /v1/cells/{cell_id}/style-explain → 命中规则与逐条求值轨迹（eval_trace）
GET  /v1/cells/{cell_id}/data-trace    → 数据血缘（来源行/公式区间/子聚合项）
PATCH /v1/definitions/{id}/overrides   → 写入语义锚定 override（草稿版本）
```

导出 API 与预览共享管道至 RenderSchema，分叉为 `.xlsx` 渲染，保证零漂移。

## 13. Excel 渲染层（excelize）

### 13.1 写入流程

物化布局下所有信息在写入前已知，渲染是纯顺序输出，无回溯：

```go
package render

// Render 将 RenderSchema 写为 .xlsx。样式 ID 需先经 NewStyle 批量注册。
func Render(s *RenderSchema, tpl *Template, w io.Writer) error {
    f := excelize.NewFile()
    sheet := "Sheet1"

    // 1) 样式字典 → excelize StyleID（模板基础样式 ⊕ 字典条目）
    styleIDs := make(map[string]int, len(s.Styles))
    for sid, st := range s.Styles {
        id, err := f.NewStyle(tpl.MergeToExcelStyle(st))
        if err != nil {
            return fmt.Errorf("style %s: %w", sid, err)
        }
        styleIDs[sid] = id
    }

    // 2) 列宽：三段策略（配置声明 > 内容测量钳制 > 默认）
    for _, c := range s.Cols {
        width := clamp(c.Width, minColWidth, maxColWidth) // 8..40
        f.SetColWidth(sheet, c.Axis(), c.Axis(), width)
        f.SetColStyle(sheet, c.Axis(), styleIDs[c.HeaderStyle])
    }

    // 3) 逐行写入：值/公式/样式
    for _, row := range s.Rows {
        for _, cell := range row.Cells {
            ref := cellRef(cell.Col, row.Idx)
            f.SetCellStyle(sheet, ref, ref, styleIDs[cell.Style])
            // 先写值（兼作公式缓存值），后写公式；顺序不可颠倒，
            // 否则 SetCellValue 会覆盖公式。缓存值行为由 spike V2 验证。
            f.SetCellValue(sheet, ref, cell.Value)
            if cell.Formula != "" {
                f.SetCellFormula(sheet, ref, cell.Formula)
            }
        }
        if h := row.Height; h > 0 {
            f.SetRowHeight(sheet, row.Idx, h)
        }
    }

    // 4) 结构件：合并、冻结、网格线、打印设置
    for _, m := range s.Merges {
        f.MergeCell(sheet, cellRef(m.C, m.R1), cellRef(m.C, m.R2))
    }
    f.SetPanes(sheet, panesFrom(s.Freeze))
    f.SetSheetView(sheet, 0, &excelize.ViewOptions{ShowGridLines: ptr(false)})
    applyPageSetup(f, sheet, s.PageSetup) // 横向/缩放到一页宽/重复表头行

    // 5) 条件格式注入（轨道 B）
    for _, cf := range s.ConditionalFormats {
        for _, rng := range cf.Ranges {
            if err := f.SetConditionalFormat(sheet, rng, cf.ToExcelFormats()); err != nil {
                return fmt.Errorf("conditional format %s: %w", cf.ID, err)
            }
        }
    }

    return f.Write(w)
}
```

### 13.2 关键实现点

| 事项 | 方案 |
|---|---|
| 公式缓存值 | 目标：公式与缓存值双写（spike V2 验证 excelize 支持度）。兜底 A：设置工作簿打开时强制重算；兜底 B：`formula_strategy: value` 只写值（可配置降级） |
| 列宽自适应 | 配置声明优先；否则 P1 位置遍的全列显示宽度测量值 + `[8,40]` 钳制；超宽文本列改 `wrapText` 且不设固定行高（Excel 打开自动撑高） |
| 合并单元格 | 维度列按组合并，合并块首行写值，垂直居中 + 按 `dim_depth` 缩进 |
| 总计置顶 | 物化模式下总计行位置由 `layout_opts.total_position` 控制，公式区间不受影响 |
| 打印标题 | 通过 defined name 写入重复表头行（spike V3 验证） |

### 13.3 技术验证清单（Spike，立项第一步）

| # | 验证项 | 影响 |
|---|---|---|
| V1 | `SetConditionalFormat` 对数据条/色阶/图标集/Top-N 的支持与参数形态 | 轨道 B 全部能力 |
| V2 | 公式单元格缓存值写入方式 | 第 8.2 节双写策略 |
| V3 | 打印标题（重复表头行）写入 | 打印友好 |
| V4 | 大行数（10 万布局行）写入耗时与内存基线 | 容量规划 |

## 14. 配置热更新与版本管理

- **版本模型**：`definitions(id, version, status: draft|published, payload, updated_by, updated_at)`；每次发布生成新 version，旧版本保留可回滚；草稿支持多人编辑的乐观锁（基于 version）。
- **发布流程**：草稿 → 发布期校验（DSL schema、样式越权、悬空 override、样例 dry-run 命中报告）→ 发布。
- **服务端缓存刷新**：进程内缓存 `id → (version, def)`；发布事件经消息总线推送失效，另以 30s TTL 轮询最大版本号兜底，双保险避免通知丢失导致的多实例不一致。
- **导出快照绑定**：任务提交时解析并绑定已发布版本号，执行全程使用该快照；发布不影响运行中任务。
- **预览默认消费最新发布版**，支持显式指定草稿版本（编辑态所见即所得）。

## 15. 任务编排

- 导出为异步任务：`Submit → 预估 → 准入排队 → 执行 → 产物落对象存储 → 返回下载链接`；任务幂等键防重复提交。
- 内存准入：并发执行槽 + 预估内存预算控制；超限任务排队而非拒绝（预估超行数上限才拒绝）。
- 进度上报：管道阶段事件（读取/聚合/样式/渲染）+ 布局行级百分比。
- 小报表快速通道：预估极小（如 < 2000 行）时可同步返回，复用同一管道。

## 16. 前端交互设计（管理端）

### 16.1 设计目标与技术选型

目标：不懂 Excel 内部机制的运营人员也能配出好看、可解释的报表。三条体验原则：

1. **不裸写 JSON**：所有配置走结构化表单与可视化控件，JSON 仅作存储格式与高级模式导入导出。
2. **每一步都有反馈**：规则命中数、条件自然语言摘要、校验错误可跳转定位。
3. **所见即所得**：预览与导出同一管道（RenderSchema），编辑即预览。

技术选型（管理端中后台场景的常规稳妥组合）：

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | React 18 + TypeScript + Vite | 生态成熟，类型安全覆盖 Schema 契约 |
| 服务端状态 | TanStack Query | 渲染结果/定义版本的缓存、失效与重试 |
| 编辑器本地状态 | Zustand | 草稿编辑态轻量、易与撤销栈集成 |
| 虚拟滚动 | TanStack Virtual | 与 RenderSchema 行窗口分页天然对应 |
| 拖拽 | dnd-kit | 图层排序、维度排序面板 |
| UI 基础组件 | Ant Design 5 | 中后台组件覆盖全，含取色器 |

### 16.2 页面结构与布局

编辑器为三栏布局：

```
┌─ 顶栏：报表名 │ 版本状态(草稿v18/已发布v17) │ 保存草稿 │ 发布 │ 历史/回滚 │ 导出
├──────────┬───────────────────────────────┬──────────────┤
│ 左 320px │ 中：预览画布                    │ 右 280px      │
│ 配置面板  │ 工具栏：样例集选择/缩放/刷新/    │ 检查器面板     │
│ Tabs:    │       下载样例xlsx             │ （选中单元格时）│
│ 维度与排序│                               │ · 样式解释     │
│ 指标配置  │ 虚拟滚动表格                    │ · 数据血缘     │
│ 样式规则  │ （RenderSchema 渲染）          │ · 样式修改入口  │
│ 条件格式  │                               │               │
│ 页面设置  │                               │               │
└──────────┴───────────────────────────────┴──────────────┘
```

另有报表列表页（入口）与版本历史抽屉（时间线 + diff + 回滚）。

### 16.3 状态管理与数据流

```
本地草稿态(Zustand) ──编辑──▶ debounce 300ms ──▶ PUT /definitions/{id}/draft (带 base_version)
                                     │ 409 → 冲突横幅（他人已保存，合并/覆盖二选一）
                                     ▼
                          POST /v1/render {draft 版本, 样例数据集, row_window}
                                     ▼
                       TanStack Query 缓存渲染结果 → 预览画布
```

- **乐观锁**：保存携带 `base_version`，冲突时不静默覆盖。
- **预览默认用样例数据集**（小，秒级全量重算）；"完整数据"模式走行窗口分页与虚拟滚动。
- **编辑期增量策略（v1 简化）**：规则/配置变更后样例数据集全量重渲染；命中范围重算优化（仅重算 dirty 规则）放在 v1.1，接口已预留 `dirty_rules` 参数。
- **撤销/重做**：草稿态接入命令模式撤销栈（Ctrl+Z），覆盖规则编辑与 override 编辑。

### 16.4 预览画布：RenderSchema 消费规范

**样式字典 → CSS**：骨架到达时把 `styles` 字典编译为 CSS 类（`st-s12 { ... }`），单元格只挂类名，避免内联样式爆炸。线型映射表：

| DSL 线型 | CSS 表现 |
|---|---|
| hair | 0.5pt solid #D9D9D9 |
| thin | 1px solid #BFBFBF |
| medium | 2px solid #404040 |
| thick | 3px solid #000000 |
| double | 3px double #000000 |
| dashed | 1px dashed #8C8C8C |

`fill → background-color`；`indent → padding-left = indent × 10px`；`bold`、`font_color` 直接映射；数值一律渲染后端 `display` 字段（格式化单一事实源在后端）。合并单元格按 `merges` 以 `grid-row/grid-column span` 实现。

**条件格式 JS 模拟**：列级 min/max 由 Schema 骨架的 `conditional_formats[].stats` 提供（后端计算，前端不再各自统计）：

- 数据条：单元格内绝对定位横条，宽度 = `(v - min) / (max - min)`；
- 色阶：两端/三色线性插值出背景色；
- Top-N：预计算命中行集合，加高亮类；
- 模拟区域右上角统一标注"预览近似"徽标（对应风险 R2）。

**交互**：单元格点击 → 选中态（描边高亮）→ 右侧检查器加载；规则卡片"定位命中"→ 画布高亮该规则全部命中单元格并滚动到首个。

### 16.5 配置面板组件

**维度与排序面板**：维度列表可拖拽调序（改变层级）；每行含字段选择器、显示名输入、升/降切换、排序依据单选（`sort_key`/值本身），选 `sort_key` 时旁列展示该元数据的 5 个样例值消除疑惑；"添加维度"从数据集字段中选。

**规则构建器（样式规则 Tab）**：规则以卡片列表呈现（即图层面板），卡片含：

- 名称、启用开关、priority（拖拽卡片调序即改优先级）、命中数徽标（来自渲染结果统计）；
- **条件区**：递归条件树编辑器，`all/any` 组内添加条件行（字段 → 操作符 → 值，操作符与输入控件类型由字段类型推导：枚举下拉、数值输入、颜色值选择）；嵌套上限 3 层；
- **样式区**：边框四边预览格（点击某边循环切换"无/线型选择/位置谓词"，位置谓词选 `at` 与 `else` 线型）、底色色板（主题色板 + 自定义取色）、加粗开关、行高输入、缩进表达式；
- **自然语言摘要**：由条件树与样式自动生成一句话，如"当 [行类型] 属于 [明细,小计] 时，应用边框规则（组首行用中粗线）与底色 #F5F7FA"，是易理解性的核心设计；
- 卡片菜单：复制、删除、导出 JSON、定位命中。

**条件格式 Tab**：作用域选择（指标列 + 是否按组）、类型选择（数据条/色阶/图标集/Top-N）、参数控件；右侧实时预览缩略图。

**预设主题包**：主题卡片墙（缩略图 + 一键套用）；套用 = 批量写入规则集与条件格式（生成新规则前提示覆盖确认）；主题以定义 JSON 分发，随服务版本内置。

### 16.6 检查器面板：样式解释、数据血缘、预览直改

选中单元格后，检查器三个区块：

1. **样式解释**：按渲染优先级倒序列出命中来源（override → 规则 DSL → 模板基础），每条含规则名与自然语言命中原因（来自 `/v1/cells/{id}/style-explain` 的 `eval_trace`）；点击条目跳转到左栏对应规则卡片并高亮。
2. **数据血缘**：明细指标单元格显示聚合函数、来源行数、主键抽样（前 5 条）；小计/总计显示公式文本、引用区间、子聚合项树（懒加载 `/v1/cells/{id}/data-trace`）；点击区间内行号可跳转画布对应行。
3. **样式修改**：提供"调整此单元格样式"入口，打开与规则卡片同款的样式控件；保存即生成语义锚定 override（后端依据当前单元格语义坐标自动生成 scope，用户可编辑 scope 扩大/收窄作用范围），并在样式解释中标注"手工调整"。

### 16.7 发布与版本交互

- **保存草稿**：仅持久化，不校验样式合法性之外的内容。
- **发布**：触发发布期校验 → 校验报告面板（错误/告警列表：悬空 override、分组数超限降级提示、规则越权），每条可跳转定位；全部通过后才允许确认发布，发布后展示命中报告摘要。
- **历史与回滚**：时间线列出各版本（作者、时间、变更摘要），任意两版本可视化 diff（规则级增删改标注），一键回滚生成新版本（不覆盖历史）。

### 16.8 性能、加载与错误态

| 场景 | 处理 |
|---|---|
| 大布局预览 | 行窗口分页（默认 200 行/窗）+ 虚拟滚动；样式字典只传一次 |
| 编辑期请求风暴 | 300ms debounce + 请求去重（同参数在途不重发） |
| 渲染失败/超时 | 画布错误占位 + 重试按钮；不影响草稿编辑 |
| 空数据集预览 | 合成 3 组 × 4 行的占位数据并标注"示例数据" |
| 首次加载 | 骨架屏：左栏表单优先可交互，画布后到 |
| 导出校准 | 预览工具栏常驻"下载样例 xlsx"，用真实产物校准视觉预期 |

### 16.9 前端消费的后端接口清单

| 接口 | 用途 |
|---|---|
| `GET/PUT /v1/definitions/{id}/draft` | 草稿读取/保存（乐观锁） |
| `POST /v1/definitions/{id}/publish` | 发布（返回校验报告与命中摘要） |
| `GET /v1/definitions/{id}/versions`、`GET .../diff?a=&b=`、`POST .../rollback` | 版本历史、diff、回滚 |
| `POST /v1/render` | 渲染分片（草稿/发布版本、样例/完整数据、row_window、dirty_rules） |
| `GET /v1/cells/{cell_id}/style-explain` | 命中规则与求值轨迹 |
| `GET /v1/cells/{cell_id}/data-trace` | 数据血缘 |
| `PATCH /v1/definitions/{id}/overrides` | 写入/编辑/删除语义锚定 override |
| `GET /v1/themes` | 预设主题列表与内容 |
| `GET /v1/datasets/{ref}/sample-fields` | 字段样例值（排序面板展示 sort_key 样例） |
| `POST /v1/export` | 提交异步导出任务，轮询进度，获取下载链接 |


## 17. 错误处理

| 场景 | 处理 |
|---|---|
| 行数超上限 | 提交期拒绝，返回收窄建议；不进入执行 |
| 数据源读取失败/超时 | 任务失败可重试（幂等键）；重试策略由任务队列管理 |
| DSL 校验失败 | 发布期阻断，逐条错误定位到规则 ID 与字段 |
| 悬空 override | 发布期告警列表，用户显式处置 |
| 分组键空值/脏值 | 归入 "(空)" 组并在血缘中标注计数，不中断导出 |
| excelize 写入错误（spike 项降级） | 按 13.2 兜底策略自动降级并记录任务告警 |

## 18. 测试策略

1. **黄金文件测试**：固定定义 + 固定数据集 → 生成 xlsx → 用 excelize 回读断言（值、公式、合并、样式、条件格式、列宽）。
2. **GroupStack 单测**：维度组合边界（0 维、单维、深嵌套、组间切换、空数据集）的事件序列断言。
3. **DSL 属性测试**：随机规则 + 随机上下文，断言求值确定性、优先级合并语义、位置谓词真值表。
4. **公式正确性**：生成文件用 LibreOffice/Excel 重算后与聚合器缓存值比对（CI 集成）。
5. **契约测试**：RenderSchema 黄金样例 + 前端解析断言，双端 CI 共享。
6. **基准测试**：10 万布局行的管道耗时与内存峰值回归。

## 19. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 文件数据源大明细外排序实现复杂 | 明细行数同样设硬阈值；外排序独立组件（分块排序 + 多路归并），独立测试 |
| R2 | HTML 预览与 Excel 视觉保真度差距 | 定位为结构与样式逻辑保真；常驻"下载样例 xlsx"校准；条件格式预览标注为近似 |
| R3 | override 在维度变更后悬空 | 发布期检测告警（第 10 节） |
| R4 | RenderSchema 契约演进卡死前后端 | 版本字段 + 契约测试 + 双版本过渡 |
| R5 | excelize 能力不确定（条件格式/打印标题/缓存值） | Spike V1-V4 立项先行，结果回填本设计 |
| R6 | 并发任务内存压力 | 内存准入 + 队列 + 行数硬上限三重防线 |
| R7 | 高频变更下的编辑冲突 | 乐观锁 + 草稿/发布分离 + 导出绑定快照 |

## 20. 实施里程碑

| 阶段 | 内容 |
|---|---|
| M0 | Spike V1-V4，结论回填设计 |
| M1 | engine：GroupStack + 布局物化 + 三遍处理 + 公式引擎（含单测与黄金文件） |
| M2 | style：DSL 解析/校验/求值 + 样式字典；datahub：DB 适配器（文件源随后） |
| M3 | schema + render：RenderSchema 契约、excelize 渲染、条件格式注入、导出任务链 |
| M4 | preview：分页渲染、样式解释、数据血缘、override；catalog 版本与热更新 |
| M5 | 管理端前端：规则构建器、图层面板、实时预览、排序面板、预设主题、版本管理 |
| M6 | 打磨：打印设置、预设主题扩充、性能基准回归 |

### P2 预留（不在本期实现）

- 图表生成（基于小计行数据）
- 派生指标表达式（占比/环比）
- 多 Sheet 分页（按顶层维度拆分）
- Web 预览的高保真渲染（字体度量对齐）

