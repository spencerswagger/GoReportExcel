# 报表编辑器预览画布 S2 化改造 设计文档

- 日期：2026-09-10
- 状态：待评审
- 相关上一篇设计：`docs/superpowers/specs/2026-09-05-dynamic-report-service-design.md`（D7：RenderSchema 单一事实源）
- 技术栈：React 18 + TypeScript + Vite + `@antv/s2-react@^2.3.1`（S2 v2）

## 1. 背景与目标

当前编辑器中栏 `PreviewCanvas` 是自研虚拟网格（`@tanstack/react-virtual` + flex 行/列 div），消费后端 `RenderSchema` 的扁平行列：行内联样式、merges 纵向合并、条件格式 JS 模拟、点击选中。自研画布在交互能力（展开折叠、拖拽调宽、行列头冻结、大数据滚动）与视觉还原上均有天花板。

本改造目标：**把编辑器预览画布从自研网格切换到 S2 渲染**，同时：

1. 后端渲染管道（GroupStack 物化 → RenderSchema 契约 → excelize 导出）**完全不动**，导出零风险；
2. 前端新增**纯函数适配层**，把 RenderSchema 还原为 S2 的 `dataCfg`（`fields`/`data`/`meta`）与视觉配置，`transform` 可单测、golden 断言；
3. 预览样式**逐格保真**：每个单元格沿用后端样式字典（四边线型、底色、加粗、字体色、缩进、行高），通过自定义单元格栈绘制；
4. 交互闭环保留：选中单元格 → 右侧检查器（样式解释/数据血缘/预览直改）、规则定位、撤销/重做、主题套用、缩放、发布/导出；
5. 新增**行头形态用户配置**（grid / grid-tree / tree），存草稿、随报表持久化，编辑器可切换。

### 范围边界

- **不做**：后端管道修改、导出行为修改、报表定义模型字段的"语义"改动。
- **不引入**：`@antv/s2-react-components`（下钻/高级排序等分析组件）——本期仅渲染与交互，后续可扩展。
- 条件格式沿用"预览近似"定位（同现有实现），保留近似徽标。

## 2. 架构与数据流

```
RenderSchema（后端契约，不变，仍是导出与预览的单一事实源）
   │
   ├─▶ transform.ts（纯函数适配层，唯一后端→S2 的边界）
   │      schema → {
   │        dataCfg: { fields, data, meta },
   │        options: 尺寸/层级形态/合并不动/条件格式/对齐,
   │        stylesMap: cell_id → ResolvedStyle,
   │        cellIdMaps: (rowId, colField) → cell_id,
   │      }
   │
   └─▶ PreviewSheet.tsx（<SheetComponent> 封装）
          sheetType: 'pivot'（0 维度回退 'table'）
          自定义单元格栈：ReportDataCell / ReportRowCell / ReportColCell / ReportCornerCell
          事件：onDataCellClick / onRowCellClick / onColCellClick → cell_id → 现有 selectedCell store
          zoom 用外层 CSS transform: scale 包裹（宽高 × zoom 补偿）
```

### 2.1 行数据重建（决策 D-A）

- 每条记录一个扁平对象：维度字段键来自 `cols`（`role === 'dimension'`，按 idx 排序）→ `cell.value`；指标字段键来自 `cols`（`role === 'metric'`）→ `cell.value`。
- **值面显示**：指标显示一律用后端 `display` 字段——记录附带 `__display`（字段名 → display）与 `__cellIds`（字段名 → cell_id）；`meta.formatter` 取 `data.__display[field]`，格式化单一事实源仍在后端。
- **小计/总计以 data-provided totals 喂给 S2**（决策 D-B）：S2 对数据提供的总计行有最高优先级（`08-totals.md`：小计行省略内层聚合维度键、总计行省略全部维度键）。后端行语义恰好如此（`RowDTO.type: subtotal|total` + `group_path`），故**聚合值零漂移**，且保留点击回溯 cell_id 的能力。
- `row_type` 等行语义附加到记录 `__row`（含 type/group_path/idx），供自定义行头与事件映射。
- **0 维度回退**：`fields.rows` 为空则 `sheetType='table'`，`fields.columns = 指标字段`，数据为每条明细记录。

### 2.2 合并单元格（决策 D-C）

- 后端 `merges`（列内纵向区间 r1..r2）翻译为 S2 `mergedCellsInfo`：`[{rowIndex, colIndex, showText}, …]`。
- 行索引基准为**数据区行的 S2 行索引**（实现时由记录顺序映射；`RowDTO.idx` 只是展示辅助，不以它为 S2 行号）。
- 覆盖范围含行头（维度）区与数据区；列头/角头如出现合并（当前管道无此输出，防御性跳过）。
- 若 S2 某版本对行头区合并支持有限，则降级为自定义 `RowCell` 内按 merges 画"首行文本 + 纵向底色/边框贯穿"，保底方案在实现时验证。

## 3. 视觉映射

| 后端概念 | S2 表达 |
|---|---|
| 维度列 | `fields.rows` + `hierarchyType`（用户配置），行头区，宽度取 `cols[idx].width × 7` |
| 指标列 | `fields.values`，数据区；`meta` 提供 `name`（cols.label）与 `formatter`（取 display） |
| 列宽 | `style.colCell.widthByField`（按字段名）；行头宽 `style.rowCell` 对应层级宽 |
| 对齐 | `conditions.text` 按字段映射 textAlign（指标右对齐、维度左对齐） |
| 样式字典逐格 | 自定义单元格：底色→fill、加粗/字体色→文本样式、缩进→文本 x 位移×indent、四边线型→G 图形矩形 stroke（线宽映射：hair/thin/medium/thick/double/dashed，复用现有 StyleSheet 线型表语义）、行高→`style.rowCell.heightByField`+`dataCell` 高 |
| data_bar | `conditions.interval`（S2 按字段自算 min/max；全局作用域与后端 stats 一致；per_group 标注近似） |
| color_scale | `conditions.background`，由后端 `stats` 插值出每格颜色（复用 `editor/conditional.ts` 的 `colorScaleColor`） |
| top_n | `conditions.background`：命中集合沿用 `applyConditional` 现有逻辑（每组/全局），命中渲染填充 |
| 行高（row.height） | `style.rowCell.heightByField`（按记录映射的 S2 行索引）与 `dataCell` 高度 |

线型 → 像素映射沿用 CSS 画布语义（hair≈0.5px、thin=1、medium=2、thick=3、double=3 双线、dashed 虚线段）。

## 4. 配置项：行头形态

- 草稿顶层新增键 `preview: { hierarchy_type: 'grid' | 'grid-tree' | 'tree' }`。
- 后端 Go 定义无此字段：`PUT draft` 存取均为原文 JSON（`server.go putDraft` 不做反序列化）；渲染/导出路径的 `UnmarshalDef → json.Marshal` 会丢弃未知键，但**导出/渲染不消费该键**，无副作用。实现时加一个往返测试确认发布校验不破坏草稿。
- 编辑器画布工具条新增 Segmented「预览形态」：grid / grid-tree / tree；改动写 `mutateDraft`（带 checkpoint 入撤销栈）。
- 默认 `grid`（与 Excel 导出行头布局对齐）；grid-tree 额外获得 S2 原生行头展开/折叠交互（不写回后端语义，仅渲染交互）。
- 切换形态不触发重渲染请求（纯前端配置，transform 同步重算）。

## 5. 交互与状态

- `selectedCell` store 契约不变：
  - 数据单元格点击：`onDataCellClick` → meta.rowIndex/colIndex → `__cellIds` → cell_id。
  - 行头/列头单元格点击：`onRowCellClick`/`onColCellClick` → 节点字段+值 → 行头 cell_id 映射表。
  - 兼容现状"选中 outline"：用 S2 `interaction.selectedCellsHighlight`/自定义 DataCell 选中态加金色描边（`#C8923E`）。
- 撤销/重做、主题套用、`SaveChip`、发布/导出、版本抽屉：不变，`EditorLayout` 仅替换画布组件。
- 缩放：保留 `zoom` 状态（0.5–2）；外层 `transform: scale(zoom)` + 容器宽高除以 zoom 以保持同视口（S2 内部不受影响）。
- 行数/列数提示：`rowTotal`、`cols.length` 展示不变。

## 6. 组件与文件规划（web/）

新建 `src/s2/` 模块：

| 文件 | 职责 |
|---|---|
| `src/s2/transform.ts` | RenderSchema → dataCfg/options/stylesMap/cellIdMaps/mergedCellsInfo；纯函数 |
| `src/s2/transform.test.ts` | golden 单测（样例 schema 来自 `api/mock.ts` 扩展 + 手写 fixture） |
| `src/s2/PreviewSheet.tsx` | `<SheetComponent>` 封装：props(schema, selectedCell, onSelect, zoom, hierarchyType)；组装 transform 输出、注册事件、缩放包裹、空态占位 |
| `src/s2/PreviewSheet.test.tsx` | 渲染冒烟：jsdom 中挂载不抛错、行/列数文本、点击事件派发不崩；视觉断言留给浏览器/playwright |
| `src/s2/customCells.ts` | ReportDataCell/ReportRowCell/ReportColCell/ReportCornerCell，读 stylesMap |
| `src/s2/s2Theme.ts` | 基础主题（字体对齐、角头文本、默认填充、滚动条样式） |
| `src/s2/hierarchy.ts` | 形态配置类型 + draft `preview` 键读写 helpers + 默认值 |

修改：

| 文件 | 变更 |
|---|---|
| `src/editor/EditorLayout.tsx` | 画布区换 `PreviewSheet`；工具条加形态 Segmented；保留 zoom/选中条 |
| `src/editor/EditorLayout.test.tsx` | 随画布替换更新（mock `PreviewSheet` 或按新结构断言） |
| `src/editor/PreviewCanvas.tsx` `StyleSheet.ts` 及其测试 | 功能被 S2 替换后删除（含 `StyleSheet.test.ts`、`PreviewCanvas.test.tsx`）；`conditional.ts` 保留（CF 命中逻辑复用） |
| `src/api/types.ts` | 仅加类型注释/`RenderSchema` 扩展字段说明，不改契约 |
| `package.json` | 新增依赖 `@antv/s2` `@antv/s2-react`（^2.3.1 与 peer `@antv/s2@^2.0.0`） |

## 7. 测试策略

1. **transform golden 测试**：固定 RenderSchema fixture（含维度/指标/合并/小计/总计/条件格式/样式字典/page_setup）→ 断言 dataCfg.fields、data 记录形态（含 `__display`/`__cellIds`/`__row`）、mergedCellsInfo 行号映射、stylesMap keys、conditions 数组。
2. **契约往返测试**：含 `preview` 键的草稿 JSON → 后端 mock（`mock-server.ts`）PUT/GET → 键保留；`catalog.UnmarshalDef`（Go 侧由现有测试覆盖）不消费它。
3. **组件冒烟**：jsdom 挂载 PreviewSheet 不抛错；形态切换重算 dataCfg；点击事件不崩与 onSelect 调用。
4. **浏览器验收**（agent-browser/playwright）：真实渲染下验证 grid（含合并）与 grid-tree（展开折叠）、选中高亮、条件格式数据条/色阶、缩放。
5. 现有 `EditorLayout.test.tsx` 调整后全绿；`npm test`、`npm run build` 通过。

## 8. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | S2 v2 API 与技能文档（v1 为主）差异 | 实现前查安装包内 `.d.ts` + S2 playground 对应示例；必要时退回 `@antv/s2@1.x` 稳定版并记录 |
| R2 | 行头区纵向合并在 `mergedCellsInfo` 支持不足 | 保底：自定义 RowCell 绘制合并效果（首行文本+区间贯穿背景/边框），实现时先行 spike |
| R3 | data-provided totals 的行内布局（小计行内嵌展示）与后端布局有偏差 | 以"预览 ≈ 导出"为准；单元测试锁定记录顺序与 `__row.type`；偏差接受并标注 |
| R4 | 样式字典逐格绘制性能（样例窗口内行数少，40 行/窗内） | S2 按需渲染；自定义单元格仅做属性覆盖，不重写 draw；切回"数据集大"场景再评估 |
| R5 | jsdom 无法绘制 canvas，组件测试深度受限 | transform/映射逻辑 100% 单测；视觉走浏览器验收 |
| R6 | 草稿新增 `preview` 键在发布校验链路被丢弃 | 契约往返测试锁定；如受阻，降级为编辑器本地存储 + 默认 grid |

## 9. 里程碑

| 阶段 | 内容 |
|---|---|
| M0 | 依赖安装；spike：S2 v2 最小 pivot 渲染 + mergedCellsInfo + 自定义单元格 + conditions，浏览器验证（对应 R1/R2/R3） |
| M1 | `transform.ts` + golden 单测（fixture 覆盖全部后端输出形态） |
| M2 | `customCells.ts` + `s2Theme.ts`：逐格样式、线型、缩进、行高、对齐 |
| M3 | `PreviewSheet.tsx`：集成 dataCfg/options/事件/缩放/空态；接入 EditorLayout；形态 Segmented + `preview` 键持久化 |
| M4 | 删除旧画布（PreviewCanvas/StyleSheet 及测试）；EditorLayout 测试更新 |
| M5 | 浏览器验收回归（含条件格式、合并、形态切换）；`npm test` + `npm run build` 全绿 |