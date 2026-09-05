# GoReportExcel —— 动态报表生成服务

基于 Golang 构建的高保真 Excel 报表生成服务，解决传统 Excel 模板无法适配"维度数量不定"与"复杂视觉样式"两大痛点。支持任意数量分组维度、运行时样式规则引擎、真实 Excel 公式、Web 预览交互与配置热更新。

## 核心能力

| 能力 | 说明 |
|---|---|
| 动态结构渲染 | 0..N 个 GroupBy 维度，自动层级缩进与合并单元格；自动生成分组小计/总计行 |
| 真实公式 | 小计/总计写入 `=SUBTOTAL(...)` 公式（多级嵌套不重复求值），并双写缓存值，pandas 等消费方打开即有值 |
| 位置/语义驱动样式 | 边框"外粗内细"等基于坐标位置的动态规则；斑马纹基于"组内逻辑序号"；规则 DSL 支持 `when`（语义条件）+ `style`（布局属性）声明式表达 |
| 样式解耦 | 基础样式（字体/数字格式）走 Excel 模板配置；布局样式（边框/底色/缩进/行高）走运行时规则引擎 |
| 值驱动样式 | 阈值/区间着色（渲染期求值）双轨 + Excel 原生条件格式（数据条/色阶/图标集/Top-N） |
| 排序配置化 | 维度排序由元数据 `sort_key` 驱动，结构化配置 |
| 可解释渲染 | 统一 `RenderSchema` 作为预览与导出的单一事实源，支持样式成因解释与数据血缘追溯 |
| 生命周期管理 | 定义版本化（草稿/发布/回滚/diff）、异步导出任务、进程内缓存 + 事件/轮询双通道热更新 |

## 技术栈与架构

- **语言**：Go 1.22+（标准库 net/http 路由、database/sql）
- **Excel 引擎**：github.com/xuri/excelize/v2（v2.9.0）
- **定义存储**：modernc.org/sqlite（纯 Go 驱动，无 CGO）
- **数据源**：CSV / JSON / SQL DB（ORDER BY 下推 + 列白名单）

```
有序明细流 → GroupStack 滚动聚合 → 布局物化（全量）
→ P1 位置遍（组边界/合并/列宽）→ P2 样式遍（规则求值/样式字典）
→ P3 装配遍（公式/条件格式/分页/打印）→ RenderSchema
→ ExcelizeRenderer（.xlsx 导出）｜ PreviewRenderer（分页 JSON）
```

包结构（`dynamic-report/`）：

| 包 | 职责 |
|---|---|
| `internal/model` | 报表定义模型与校验（维度/指标/规则/override/条件格式） |
| `internal/style` | 样式规则 DSL：解析、谓词求值、优先级合并引擎、条件解释（自然语言） |
| `internal/engine` | GroupStack 聚合、布局物化、P1 位置遍、P3 装配遍、数据血缘抽样 |
| `internal/datahub` | 数据源适配（Slise/CSV/SQL），排序与类型规整 |
| `internal/schema` | RenderSchema 构建：样式字典去重、合并、公式、分页、条件格式展开 |
| `internal/render` | excelize 渲染：样式/合并/冻结/列宽/条件格式注入/打印设置 |
| `internal/pipeline` | 管道装配（导出与预览共用），override 编译为最高优先级规则 |
| `internal/catalog` | 定义存储（SQLite）与缓存热更新（失效通知 + TTL 兜底） |
| `internal/orchestrator` | 异步导出任务队列（幂等键/并发槽/进度/产物） |
| `internal/httpapi` | HTTP API：定义生命周期、渲染预览、样式解释、数据血缘、导出 |

## 快速开始

### 环境要求

- Go 1.22+（`go.mod` 已锁定 xuri/excelize v2.9.0 与 modernc.org/sqlite）

### CLI 导出（核心引擎）

```bash
cd dynamic-report
go run ./cmd/reportgen \
  -def internal/model/testdata/valid.json \
  -data internal/datahub/testdata/sales.csv \
  -o report.xlsx \
  -schema-out schema.json
```

输出 `report.xlsx`（含两级小计、合并单元格、SUBTOTAL 公式与缓存值、冻结窗格、列宽自适应），`schema.json`（RenderSchema 便于前端调试）。

### 服务（计划二已规划，待实施）

```bash
go run ./cmd/reportserv -addr :8080 -db catalog.db -artifacts artifacts -csv .
```

核心流程：`PUT /v1/definitions/{id}/draft` 保存草稿 → `POST /v1/definitions/{id}/publish` 发布 → `POST /v1/export` 提交异步导出 → `GET /v1/export/{taskId}/download` 下载。

## 管理端前端（计划三）

```bash
cd web
npm install
npm run dev      # 开发服务（MSW mock 后端 API，端口 5173）
npm test         # Vitest（MSW 契约测试）
npm run build    # 产物 dist/（对接真实后端时关闭 mock 并配置 VITE_API_BASE）
```

编辑器路由 `/editor/:id`：左栏配置（维度排序/指标/样式规则图层/条件格式/页面设置）、中栏实时预览（样式字典 CSS、合并、条件格式 JS 模拟、虚拟滚动）、右栏检查器（样式解释/数据血缘/预览直改生成 override）。顶栏支持防抖自动保存、发布、版本历史与回滚、异步导出（轮询进度 + 下载）。

## 报表定义示例

```json
{
  "id": "rpt_sales",
  "version": 1,
  "name": "销售报表",
  "dataset": {
    "source_ref": "csv_local",
    "fields": [
      {"key": "region", "type": "string", "sort_key": "region_order"},
      {"key": "city",   "type": "string"},
      {"key": "amount", "type": "number"},
      {"key": "qty",    "type": "number"}
    ]
  },
  "dimensions": [
    {"field": "region", "label": "大区", "sort": {"by": "sort_key", "dir": "asc"}},
    {"field": "city",   "label": "城市", "sort": {"by": "value",    "dir": "asc"}}
  ],
  "metrics": [
    {"field": "amount", "label": "销售额", "agg": "SUM",   "num_fmt_ref": "money"},
    {"field": "qty",    "label": "件数",   "agg": "COUNT", "num_fmt_ref": "int"}
  ],
  "layout_opts": {"total_position": "bottom"},
  "base_styles": {
    "header_font": {"name": "Arial", "size": 11, "bold": true},
    "body_font":   {"name": "Arial", "size": 10},
    "num_formats": {"money": "#,##0.00", "int": "#,##0"}
  },
  "style_rules": {"version": 1, "rules": [ ... ]}
}
```

## 样式规则 DSL 示例

```json
{
  "id": "outer-thick-inner-thin",
  "priority": 100,
  "when": {"ctx": "row_type", "op": "in", "values": ["detail", "subtotal"]},
  "style": {
    "border": {
      "top":    {"at": "group_first_row", "style": "medium", "else": "hair"},
      "bottom": {"at": "group_last_row",  "style": "medium", "else": "hair"},
      "left":   {"at": "group_first_col", "style": "medium", "else": "hair"},
      "right":  {"at": "group_last_col",  "style": "medium", "else": "hair"}
    }
  }
}
```

规则按 `priority` 升序叠加；`at` 位置谓词（组首/末行、组首/末列、表首/末行）把"外粗内细"表达为声明而非坐标硬编码；斑马纹用 `seq_in_group % 2 == 0`（组内逻辑序号，非全局物理行号）。

## 测试

```bash
cd dynamic-report
go test ./... -v    # 60+ 用例：DSL 求值/聚合算法/布局遍/渲染回读/存储/缓存/队列
go vet ./...
```

关键测试策略：excelize 能力 spike（`spikes/FINDINGS.md`）、渲染黄金回读测试、GroupStack 行序与区间推演断言、并发竞态测试。

## 文档

- 设计文档：`docs/superpowers/specs/2026-09-05-dynamic-report-service-design.md`
- 计划一（核心引擎 + CLI）：`docs/superpowers/plans/2026-09-05-core-engine-export.md`
- 计划二（服务化）：`docs/superpowers/plans/2026-09-05-service-layer.md`
- excelize 能力验证结论：`dynamic-report/spikes/FINDINGS.md`

## 路线图

- [x] 计划一：核心引擎（聚合/风格 DSL/RenderSchema/渲染/CLI）—— 已交付
- [ ] 计划二：服务化（HTTP API/定义版本与热更新/异步导出/条件格式/预览交互）—— 计划已完成，待实施
- [x] 计划三：管理端前端（规则构建器/图层面板/实时预览/版本管理）