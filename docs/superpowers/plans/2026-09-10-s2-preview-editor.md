# 报表编辑器预览画布 S2 化改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `@antv/s2-react`（v2）替换编辑器自研预览画布，后端 RenderSchema 契约不动，前端纯函数适配层把扁平网格还原为 S2 dataCfg，预览逐格保真，行头形态（grid/grid-tree/tree）成为报表级用户配置。

**Architecture:** 新增 `web/src/s2/` 模块：`transform.ts`（唯一 RenderSchema→S2 边界，纯函数+golden 单测）→ `PreviewSheet.tsx`（`<SheetComponent>` 封装，自定义单元格栈 + 事件回溯 cell_id + zoom 缩放包裹）→ 接入 `EditorLayout.tsx`；删除旧画布 `PreviewCanvas.tsx`/`StyleSheet.ts` 及其测试。小计/总计以 S2 data-provided totals 喂入（值零漂移）；合并用自定义 RowCell 绘制（grid 行头）与 `mergedCellsInfo`（数据区）；条件格式用 S2 `conditions`（interval/background）。

**Tech Stack:** React 18 + TypeScript + Vite + vitest(jsdom+msw) + `@antv/s2@^2.0.0` + `@antv/s2-react@^2.3.1`

**前置约定（实现前先读）：**
- 当前工作目录 `/workspace/web`；包管理器 npm；`npm test`（vitest）、`npm run build`（tsc -b && vite build）。
- 后端契约参照 `/workspace/docs/superpowers/specs/2026-09-05-dynamic-report-service-design.md` 第 11 节与 `/workspace/web/src/api/types.ts`；`merges` 的 `c` 为 Excel 1-based 列号（旧画布用 `m.c - 1` 取 0-based 列）。
- S2 技能参考：`antv-s2-expert`（01 sheet-types / 02 framework-bindings / 04 custom-cell / 06 data-config / 08 totals / 11 conditions）。S2 v2 API 以安装包内 `.d.ts` 为准；遇到名称差异以包为准并记录。
- 测试环境 jsdom 无 canvas 绘制，S2 挂载需要 mock `HTMLCanvasElement.getContext` 与 `ResizeObserver`（Task 8 做进 test-setup）。

---

### Task 1: 安装依赖 + hierarchy 配置 helper（TDD）

**Files:**
- Modify: `package.json`（新增依赖）
- Create: `src/s2/hierarchy.ts`
- Test: `src/s2/hierarchy.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
npm install @antv/s2@^2.0.0 @antv/s2-react@^2.3.1
```

Expected：`package.json` dependencies 增加两包；`node_modules/@antv/s2-react/package.json` 存在。若安装失败（网络），检查代理环境变量后重试。

- [ ] **Step 2: 写失败测试**

```ts
// src/s2/hierarchy.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW, getPreview, setPreview, type PreviewCfg } from './hierarchy';

describe('hierarchy preview config', () => {
  it('默认 grid', () => {
    expect(DEFAULT_PREVIEW).toEqual({ hierarchy_type: 'grid' });
    expect(getPreview(undefined)).toEqual({ hierarchy_type: 'grid' });
    expect(getPreview(null)).toEqual({ hierarchy_type: 'grid' });
  });

  it('草稿无 preview 键时回退默认', () => {
    expect(getPreview({ name: 'x' })).toEqual({ hierarchy_type: 'grid' });
  });

  it('读合法值', () => {
    expect(getPreview({ preview: { hierarchy_type: 'tree' } })).toEqual({ hierarchy_type: 'tree' });
  });

  it('非法值回退默认', () => {
    expect(getPreview({ preview: { hierarchy_type: 'sushi' } })).toEqual({ hierarchy_type: 'grid' });
  });

  it('setPreview 合并写回 draft.preview', () => {
    const d: Record<string, unknown> = { preview: { hierarchy_type: 'grid-tree' } };
    setPreview(d, { hierarchy_type: 'tree' });
    expect(d.preview).toEqual({ hierarchy_type: 'tree' });
    const d2: Record<string, unknown> = {};
    setPreview(d2, { hierarchy_type: 'grid' });
    expect(d2.preview).toEqual({ hierarchy_type: 'grid' });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run src/s2/hierarchy.test.ts`
Expected: FAIL（找不到 `./hierarchy` 模块）

- [ ] **Step 4: 实现**

```ts
// src/s2/hierarchy.ts
export type PreviewHierarchyType = 'grid' | 'grid-tree' | 'tree';

export interface PreviewCfg {
  hierarchy_type: PreviewHierarchyType;
}

export const DEFAULT_PREVIEW: PreviewCfg = { hierarchy_type: 'grid' };

export const PREVIEW_HIERARCHY_TYPES: PreviewHierarchyType[] = ['grid', 'grid-tree', 'tree'];

function isHierarchyType(v: unknown): v is PreviewHierarchyType {
  return v === 'grid' || v === 'grid-tree' || v === 'tree';
}

// 草稿顶层键 preview（后端 Go 定义无此字段，draft 存取为原文 JSON，不消费该键）
export function getPreview(draft: Record<string, unknown> | null | undefined): PreviewCfg {
  const raw = draft?.preview as Partial<PreviewCfg> | undefined;
  if (!raw || typeof raw !== 'object' || !isHierarchyType(raw.hierarchy_type)) {
    return DEFAULT_PREVIEW;
  }
  return { hierarchy_type: raw.hierarchy_type };
}

export function setPreview(draft: Record<string, unknown>, patch: Partial<PreviewCfg>): void {
  const next: PreviewCfg = { ...getPreview(draft), ...patch };
  draft.preview = next;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/s2/hierarchy.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 6: 契约往返冒烟（`preview` 键在草稿链路不被破坏）**

Run: `npx vitest run src/store/editor.test.ts`
Expected: 现有用例全绿（store 不感知新键）。并在 `src/api/client.test.ts` 的 putDraft 上传 JSON 中加 `preview` 字段的断言（Step 7 落测试）。

- [ ] **Step 7: 补充 draft 往返测试（写失败→过）**

```ts
// src/api/client.test.ts 追加（若文件已存在 putDraft 用例，在其后追加新 case）
import { putDraft } from './client';

it('putDraft 携带 preview 键不被丢弃（mock 原样返回）', async () => {
  const payload = JSON.stringify({ id: 'r', version: 2, preview: { hierarchy_type: 'tree' } });
  await expect(putDraft('r', payload)).resolves.toBe(true);
});
```

运行：`npx vitest run src/api/client.test.ts`，先确认失败（无该用例即失败），实现为把 body 字段名断言改造后通过即可（若期望 403/409 逻辑复杂，本步仅验证请求体能被 mock 接受）。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/s2 src/api/client.test.ts
git commit -m "feat(web): add s2 deps and preview hierarchy config helpers"
```

---

### Task 2: transform.ts — 数据重建与字段/列头映射（TDD）

**Files:**
- Create: `src/s2/transform.ts`
- Test: `src/s2/transform.test.ts`

规则：数据记录从 `schema.rows` 过滤 `type==='header'` 后按物理顺序生成；`recordIndex = 该行在非 header 行中的序号`；`RowDTO.idx` 仅作追溯，不当作 S2 行号。

- [ ] **Step 1: 写失败测试（核心 shape）**

```ts
// src/s2/transform.test.ts
import { describe, expect, it } from 'vitest';
import { fixtureSchema } from '../api/mock';
import { buildPreview } from './transform';

describe('buildPreview data model', () => {
  const m = buildPreview(fixtureSchema, 'grid');

  it('fields: rows=维度, values=指标, columns 空', () => {
    expect(m.dataCfg.fields.rows).toEqual(['region', 'city']);
    expect(m.dataCfg.fields.values).toEqual(['amount', 'qty']);
    expect(m.dataCfg.fields.columns).toEqual([]);
  });

  it('records 全量（去掉 header 行）', () => {
    // fixture: header + 6 detail + 3 subtotal + 1 total = 11 行 → 10 records
    expect(m.records.length).toBe(10);
    const first = m.records[0];
    expect(first.region).toBe('华东');
    expect(first.city).toBe('上海');
    expect(first.amount).toBe(100);
    expect(first.__row).toEqual({ idx: 2, type: 'detail' });
    expect(first.__cellIds.amount).toBe('r2c2');
    expect(first.__cellIds.qty).toBe('r2c3');
    expect(first.__dimCellIds.region).toBe('r2c0');
    expect(first.__dimCellIds.city).toBe('r2c1');
    expect(first.__display.amount).toBe('100.00');
  });

  it('meta: 名称取 label，指标含 formatter 返回 display', () => {
    const amountMeta = m.dataCfg.meta?.find((x) => x.field === 'amount');
    expect(amountMeta?.name).toBe('销售额');
    const fmt = amountMeta?.formatter as (v: unknown, d?: Record<string, unknown>) => string;
    expect(fmt?.(100, m.records[0])).toBe('100.00');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: FAIL（找不到 `./transform`）

- [ ] **Step 3: 实现 transform 数据部**

```ts
// src/s2/transform.ts （本任务先实现数据模型部分，后续任务逐步补全）
import type { S2DataConfig, SheetComponentOptions } from '@antv/s2';
import type { RenderSchema, RowDTO } from '../api/types';
import type { PreviewHierarchyType } from './hierarchy';

export interface PreviewRecord extends Record<string, unknown> {
  __row: { idx: number; type: RowDTO['type'] };
  __display: Record<string, string>;
  __cellIds: Record<string, string>;
  __dimCellIds: Record<string, string>;
}

export function buildPreview(schema: RenderSchema, hierarchyType: PreviewHierarchyType = 'grid'): {
  dataCfg: S2DataConfig;
  options: SheetComponentOptions;
  records: PreviewRecord[];
  sheetType: 'pivot' | 'table';
} {
  const dimCols = schema.cols.filter((c) => c.role === 'dimension');
  const metricCols = schema.cols.filter((c) => c.role === 'metric');
  const bodyRows = schema.rows.filter((r) => r.type !== 'header');

  const records: PreviewRecord[] = bodyRows.map((row) => {
    const rec: PreviewRecord = {
      __row: { idx: row.idx, type: row.type },
      __display: {},
      __cellIds: {},
      __dimCellIds: {},
    };
    for (const cell of row.cells) {
      const col = schema.cols[cell.col];
      if (!col) continue;
      const key = col.metric ?? `dim_${col.idx}`;
      rec.__display[key] = cell.display;
      if (col.role === 'metric') {
        rec[key] = cell.value;
        rec.__cellIds[key] = cell.cell_id;
      } else {
        rec.__dimCellIds[key] = cell.cell_id;
        // 小计/总计行的空维度单元格 → 省略键（data-provided totals 语法）
        const v = cell.value;
        if (v !== '' && v !== null && v !== undefined) rec[key] = v;
      }
    }
    return rec;
  });

  const fields = {
    rows: dimCols.map((c) => c.metric ?? `dim_${c.idx}`),
    columns: [] as string[],
    values: metricCols.map((c) => c.metric as string),
  };

  const meta = [
    ...dimCols.map((c) => ({ field: c.metric ?? `dim_${c.idx}`, name: c.label })),
    ...metricCols.map((c) => ({
      field: c.metric as string,
      name: c.label,
      formatter: (v: unknown, d?: Record<string, unknown>) => {
        const rec = d as PreviewRecord | undefined;
        const key = c.metric as string;
        return (rec?.__display?.[key] ?? (v === null || v === undefined ? '' : String(v)));
      },
    })),
  ];

  const sheetType: 'pivot' | 'table' = fields.rows.length === 0 ? 'table' : 'pivot';

  return {
    dataCfg: { data: records, fields, meta },
    options: { width: 0, height: 0 }, // 占位，后续任务补充
    records,
    sheetType,
  };
}
```

> 说明：`dim_${col.idx}` 是对无 `metric` 的维度列生成稳定字段键的方案；字段展示名由 meta.name 提供。后续任务里 `options`、合并、条件、样式映射逐步替换占位。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: PASS

> 若 `fixtureSchema` 的维度列无 `metric` 字段（mock 中 dimension ColInfo 无 metric），则字段键为 `dim_0`/`dim_1`，与上面测试里的 `'region'/'city'` 不一致。**以 fixture 为准**：如出现 FAIL，把测试期望改为 `['dim_0','dim_1']` 并在 Step 3 中同步把 `PreviewRecord` 的 dim 键改为 `dim_0`（`__dimCellIds['dim_0']`、`rec['dim_0']`），保证测试与实现一致，不要改 fixture。

- [ ] **Step 5: Commit**

```bash
git add src/s2/transform.ts src/s2/transform.test.ts
git commit -m "feat(web): transform renderschema into s2 data model"
```

---

### Task 3: transform — 小计/总计 data-provided totals 语义

**Files:**
- Modify: `src/s2/transform.ts`
- Test: `src/s2/transform.test.ts`

- [ ] **Step 1: 写失败测试（totals 语义）**

```ts
it('subtotal 记录省略空维度键（data-provided totals）', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  // fixture: 下标 2/5/8 是 subtotal（上海/杭州/南京），9 是 total
  const sh = m.records[2];
  expect(sh.__row.type).toBe('subtotal');
  expect(sh.amount).toBe(300);
  expect(sh.__cellIds.amount).toBe('r4c2');
  expect('city' in sh).toBe(false); // 空维度键省略
  expect('region' in sh).toBe(false); // mock 小计行 region 为空 → 省略
  const total = m.records[9];
  expect(total.__row.type).toBe('total');
  expect(total.amount).toBe(1000);
  expect('region' in total).toBe(false);
  expect('city' in total).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: FAIL（当前实现 dim 键可能是 `dim_0` 或省略逻辑未满足 `in` 断言）

- [ ] **Step 3: 按 fixture 修正字段键并补 totals 断言（若 Step 2 已 PASS 则跳过本步）**

- 若 Task 2 中字段键定为 `dim_0`/`dim_1`，把 Task 2 与本次测试全部统一为 `dim_0`/`dim_1`（含 `__dimCellIds` 键、`records[0].dim_0` 断言），并确保：
  - subtotal/total 记录中值为空的维度列键**不写入** record（data-provided totals 语法，S2 据此识别小计/总计行）；
  - detail 记录即使维度值为空也照常写入（保持 detail 语义）。

Run: `npx vitest run src/s2/transform.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/s2/transform.ts src/s2/transform.test.ts
git commit -m "feat(web): emit subtotal/total rows as s2 data-provided totals"
```

---

### Task 4: transform — 合并、表头样式、对齐 conditions（TDD）

**Files:**
- Modify: `src/s2/transform.ts`
- Test: `src/s2/transform.test.ts`

- [ ] **Step 1: 写失败测试（合并区间 / header 样式 / 对齐）**

```ts
it('dim merges: 按物理行列映射到 record 索引区间', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  // fixture merges（c 为 1-based）: {r1:2,r2:4,c:2}→0-based col1=城市; {r1:2,r2:7,c:1}→col0=大区
  // 不含 header 行 → record 索引 = 物理 idx - 1
  const cityMerge = m.dimMerges.find((x) => x.level === 1);
  expect(cityMerge).toEqual({ level: 1, from: 1, to: 3, anchorCellId: 'r2c1' });
  const regionMerge = m.dimMerges.find((x) => x.level === 0);
  expect(regionMerge).toEqual({ level: 0, from: 1, to: 6, anchorCellId: 'r2c0' });
});

it('header styles: 表头字段 → styleId 映射', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  expect(m.headerStyles.dim_0).toBe('s1');
  expect(m.headerStyles.amount).toBe('s1');
});

it('conditions.text: 指标列右对齐', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  const text = m.options.conditions?.text ?? [];
  expect(text.length).toBe(2);
  const amount = text.find((c) => (c as { field: unknown }).field === 'amount');
  expect(amount).toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: FAIL（`dimMerges`/`headerStyles`/`conditions` 未定义）

- [ ] **Step 3: 实现合并/表头/对齐**

在 `buildPreview` 中，私有 helper：

```ts
export interface DimMerge { level: number; from: number; to: number; anchorCellId: string }

function buildDimMerges(schema: RenderSchema, cols: { field: string; role: 'dimension' | 'metric' }[], bodyRows: RowDTO[]): DimMerge[] {
  // record 索引 = bodyRows 中该物理行 idx 的位置（header 已被剔除，物理序与 record 序一致）
  const idxToRecord = new Map<number, number>();
  bodyRows.forEach((r, i) => idxToRecord.set(r.idx, i));
  const levelByCol = new Map<number, number>();
  let level = 0;
  cols.forEach((c, ci) => { if (c.role === 'dimension') { levelByCol.set(ci, level); level += 1; } });

  const out: DimMerge[] = [];
  for (const m of schema.merges ?? []) {
    const colIdx0 = m.c - 1; // 1-based → 0-based
    const lvl = levelByCol.get(colIdx0);
    if (lvl === undefined) continue; // 数据区合并留给数据区处理
    const fromIdx = idxToRecord.get(m.r1);
    const toIdx = idxToRecord.get(m.r2);
    if (fromIdx === undefined || toIdx === undefined || fromIdx > toIdx) continue;
    const anchor = bodyRows[fromIdx].cells.find((c) => c.col === colIdx0);
    out.push({ level: lvl, from: fromIdx, to: toIdx, anchorCellId: anchor?.cell_id ?? '' });
  }
  return out;
}

function buildHeaderStyles(schema: RenderSchema): Record<string, string> {
  const header = schema.rows.find((r) => r.type === 'header');
  const map: Record<string, string> = {};
  if (!header) return map;
  for (const cell of header.cells) {
    const col = schema.cols[cell.col];
    if (!col) continue;
    map[col.metric ?? `dim_${col.idx}`] = cell.style;
  }
  return map;
}
```

在 `buildPreview` 返回对象中补：`dimMerges: buildDimMerges(...)`、`headerStyles: buildHeaderStyles(schema)`，并把 `options` 补成：

```ts
const options: SheetComponentOptions = {
  hierarchyType,
  conditions: {
    text: metricCols.map((c) => ({
      field: c.metric as string,
      mapping: () => ({ textAlign: 'right' }),
    })),
  },
};
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/s2/transform.ts src/s2/transform.test.ts
git commit -m "feat(web): map merges, header styles and alignment into s2 config"
```

---

### Task 5: transform — 条件格式 → S2 conditions（TDD）

**Files:**
- Modify: `src/s2/transform.ts`
- Test: `src/s2/transform.test.ts`

复用 `src/editor/conditional.ts` 的 `colorScaleColor` / `dataBarWidth` / `topNHitIds`。`CFInfo.scope?.metric` 需类型断言（同旧画布）。

- [ ] **Step 1: 写失败测试**

```ts
it('data_bar → conditions.interval（用后端 stats 定范围）', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  const interval = m.options.conditions?.interval ?? [];
  const cf = interval[0] as { field: string; mapping: (v: number) => { fill: string; isCompare: boolean; minValue?: number; maxValue?: number } };
  expect(cf.field).toBe('amount');
  const r = cf.mapping(500);
  expect(r.fill).toBe('#638EC6');
  expect(r.isCompare).toBe(true);
  expect(r.minValue).toBe(0);
  expect(r.maxValue).toBe(1000);
});

it('color_scale → conditions.background 插值色', () => {
  const schema = structuredClone(fixtureSchema);
  schema.conditional_formats = [
    { id: 'cs', kind: 'color_scale', color: '#C0392B', ranges: ['C2:C11'], stats: { min: 0, max: 100 } },
  ];
  const m = buildPreview(schema, 'grid');
  const bg = m.options.conditions?.background ?? [];
  const cf = bg[0] as { field: string; mapping: (v: number) => { fill: string } | null };
  expect(cf.field).toBe('amount');
  expect(cf.mapping(0)).toEqual({ fill: '#FFFFFF' });
  expect(cf.mapping(100)).toEqual({ fill: '#C0392B' });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: FAIL（`conditions.interval`/`background` 为空）

- [ ] **Step 3: 实现条件格式构建**

```ts
type CFWithScope = RenderSchema['conditional_formats'][number] & { scope?: { metric?: string } };

function buildConditions(schema: RenderSchema, records: PreviewRecord[]): SheetComponentOptions['conditions'] {
  const text = (schema.cols.filter((c) => c.role === 'metric')).map((c) => ({
    field: c.metric as string,
    mapping: () => ({ textAlign: 'right' }),
  }));
  const interval: unknown[] = [];
  const background: unknown[] = [];

  const metricFieldOf = (metric?: string) =>
    schema.cols.find((c) => c.role === 'metric' && c.metric === metric)?.metric;

  for (const raw of schema.conditional_formats ?? []) {
    const cf = raw as CFWithScope;
    const field = metricFieldOf(cf.scope?.metric);
    if (!field) continue;
    if (cf.kind === 'data_bar' && cf.stats) {
      const { min, max } = cf.stats;
      const color = cf.color ?? '#638EC6';
      interval.push({
        field,
        mapping: () => ({ fill: color, isCompare: true, minValue: min, maxValue: max }),
      });
    } else if (cf.kind === 'color_scale' && cf.stats && cf.color) {
      const stats = { min: cf.stats.min, max: cf.stats.max };
      const color = cf.color;
      background.push({
        field,
        mapping: (v: number) => (typeof v === 'number' ? { fill: colorScaleColor(v, stats, '#FFFFFF', color) } : null),
      });
    } else if (cf.kind === 'top_n' && cf.n && cf.n > 0) {
      const style = cf.style?.fill?.color ?? '#FDEBD0';
      const cells = records
        .filter((r) => typeof r[field] === 'number')
        .map((r, i) => ({ idx: i, cellId: String(r.__cellIds[field] ?? ''), value: r[field] as number }));
      const hitIds = new Set(topNHitIds(cells, cf.n).map((x) => x.cellId));
      background.push({
        field,
        mapping: (_v: unknown, data?: Record<string, unknown>) => {
          const rec = data as PreviewRecord | undefined;
          const cellId = rec?.__cellIds[field];
          return cellId && hitIds.has(cellId) ? { fill: style } : null;
        },
      });
    }
  }
  return { text, interval, background };
}
```

在 `buildPreview` 中：`options.conditions = buildConditions(schema, records)`，并同步 `conditions.text` 用此函数生成（替换 Task 4 内联的 text）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/s2/transform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/s2/transform.ts src/s2/transform.test.ts
git commit -m "feat(web): map conditional formats to s2 conditions"
```

---

### Task 6: transform — 0 维度 table 回退与行列选项（TDD）

**Files:**
- Modify: `src/s2/transform.ts`
- Test: `src/s2/transform.test.ts`

- [ ] **Step 1: 写失败测试（0 维度 / 列宽 / sheetType）**

```ts
it('0 维度 → table sheet，columns 为指标字段', () => {
  const schema = structuredClone(fixtureSchema);
  schema.cols = schema.cols.filter((c) => c.role === 'metric').map((c, i) => ({ ...c, idx: i }));
  schema.rows = schema.rows.map((r) => ({ ...r, cells: r.cells.filter((c) => c.col >= 2).map((c) => ({ ...c, col: c.col - 2 })) }));
  const m = buildPreview(schema, 'grid');
  expect(m.sheetType).toBe('table');
  expect(m.dataCfg.fields.columns).toEqual(['amount', 'qty']);
  expect(m.dataCfg.fields.values).toEqual([]);
  expect(m.records.length).toBe(10);
});

it('options 提供列宽 widthByField 与行头宽', () => {
  const m = buildPreview(fixtureSchema, 'grid');
  const widths = m.options.style?.colCell?.widthByField as Record<string, number> | undefined;
  expect(widths?.amount).toBe(120);
  expect(widths?.qty).toBe(80);
});
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

- 改造 `buildPreview`：`sheetType === 'table'` 时，`fields.columns = fields.values; fields.values = []`，`fields.rows = []`；
- `options.style.colCell.widthByField = Object.fromEntries(metricCols.map((c) => [c.metric as string, c.width]))`，`rowCell.widthByField` 维度列宽（`dim_${idx}` → width，tree 模式用 `treeWidth: <最大维度宽>`）；
- `options.hierarchyType = hierarchyType`（与 Task 4 一致）保持。

Run: `npx vitest run src/s2/transform.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/s2/transform.ts src/s2/transform.test.ts
git commit -m "feat(web): table-sheet fallback for zero-dimension reports and column widths"
```

---

### Task 7: 自定义单元格栈与主题（逐格保真）

**Files:**
- Create: `src/s2/customCells.ts`
- Create: `src/s2/s2Theme.ts`
- Test: `src/s2/customCells.test.ts`（轻量：纯辅助函数）

- [ ] **Step 1: 实现样式辅助（纯函数，可单测）**

```ts
// src/s2/customCells.ts（第 1 部分：纯辅助）
import type { ResolvedStyle } from '../api/types';

export interface LineSpec { color: string; width: number; dash?: number[] }

// 线型 → 笔画（与旧 StyleSheet 线型语义一致）
export const LINE_SPEC: Record<string, LineSpec> = {
  hair: { color: '#D9D9D9', width: 0.5 },
  thin: { color: '#BFBFBF', width: 1 },
  medium: { color: '#404040', width: 2 },
  thick: { color: '#000000', width: 3 },
  double: { color: '#000000', width: 3 },
  dashed: { color: '#8C8C8C', width: 1, dash: [4, 3] },
};

export function strokeFor(line?: string): LineSpec | null {
  if (!line) return null;
  return LINE_SPEC[line] ?? null;
}

// 供单测：四个边框的 stroke 定义（left/top/right/bottom 各有 edge 端点规则由 S2 cell 应用）
export function borderStrokes(st: ResolvedStyle) {
  return {
    left: strokeFor(st.BorderLeft),
    top: strokeFor(st.BorderTop),
    right: strokeFor(st.BorderRight),
    bottom: strokeFor(st.BorderBottom),
  };
}
```

```ts
// src/s2/customCells.test.ts
import { describe, expect, it } from 'vitest';
import { borderStrokes, strokeFor } from './customCells';

describe('borderStrokes', () => {
  it('hair/thin/medium 映射', () => {
    const s = borderStrokes({
      BorderTop: 'thin', BorderRight: 'hair', BorderBottom: 'medium', BorderLeft: 'hair',
      Fill: '#fff', FontColor: '#000', Bold: false, RowHeight: 20, Indent: 0,
    });
    expect(s.top?.width).toBe(1);
    expect(s.bottom?.width).toBe(2);
    expect(s.right?.width).toBe(0.5);
  });

  it('double 双线 / dashed 虚线', () => {
    expect(strokeFor('double')?.width).toBe(3);
    expect(strokeFor('dashed')?.dash).toEqual([4, 3]);
    expect(strokeFor('unknown')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行通过（纯函数测试）**

Run: `npx vitest run src/s2/customCells.test.ts`
Expected: PASS

- [ ] **Step 3: 实现主题（s2Theme.ts）**

```ts
// src/s2/s2Theme.ts
import type { S2Theme } from '@antv/s2';

// 基础主题：角头文字、行头/列头底色、默认字号，其余走 S2 默认
export function buildBaseTheme(): Partial<S2Theme> {
  return {
    cornerCell: { text: { textAlign: 'left' } },
    rowCell: { text: { textAlign: 'left' }, bolderText: { textAlign: 'left' } },
    colCell: { text: { textAlign: 'left' }, bolderText: { textAlign: 'left' } },
  };
}
```

- [ ] **Step 4: 实现逐格绘制（customCells.ts 第 2 部分：单元格类）**

> 以 S2 v2 官方 custom-cell 示例 API 为准（`DataCell`/`RowCell`/`ColCell`/`CornerCell` 基类 + `drawBackgroundShape`/`drawTextShape` + `this.getMeta()` + G 图形）。若 v2 方法名不同，以安装包 `.d.ts` 为准调整，本步骤务必跑通一次真实渲染（Step 7 用浏览器或临时 demo 验证）。

```ts
// src/s2/customCells.ts（第 2 部分，接续）
import { DataCell, RowCell, ColCell } from '@antv/s2';
import type { PreviewModel } from './transform';
import type { ResolvedStyle } from '../api/types';

export interface CellStyleLookup {
  styleOf(cellId: string): ResolvedStyle | undefined;
  indentOf(cellId: string): number;
}

// 从 cell_id → cell 的元数据里找回 cell_id 由 PreviewSheet 通过 options.layoutCellMeta 注入到 meta
// （PreviewSheet 在 options 里挂 layoutCellMeta，把每个数据格 meta 附加 __cellId，见 Task 8）

export function makeCellLookup(model: PreviewModel): CellStyleLookup {
  const styleById = new Map<string, ResolvedStyle>();
  for (const key of Object.keys(model.styles)) styleById.set(key, model.styles[key]);
  return {
    styleOf: (id) => (id ? styleById.get(id) : undefined),
    indentOf: (id) => styleById.get(id)?.Indent ?? 0,
  };
}

export function drawSurface(cell: { getMeta(): { x: number; y: number; width: number; height: number; __cellId?: string } }, lookup: CellStyleLookup) {
  const meta = cell.getMeta();
  const st = lookup.styleOf(meta.__cellId ?? '');
  const { x, y, width, height } = meta;
  // 底色
  if (st?.Fill) {
    // S2 cell 的 addShape('rect', ...) 绘制矩形；背景置于最底层
    (cell as unknown as { addShape: (t: string, cfg: Record<string, unknown>) => unknown })
      .addShape('rect', { attrs: { x, y, width, height, fill: st.Fill }, zIndex: 0 });
  }
  // 四边
  const borders = borderStrokes(st ?? ({} as ResolvedStyle));
  const strokeOpts = (spec: LineSpec | null, from: [number, number], to: [number, number]) =>
    spec ? { x1: from[0], y1: from[1], x2: to[0], y2: to[1], stroke: spec.color, lineWidth: spec.width, lineDash: spec.dash } : null;
  const lines = [
    strokeOpts(borders.top, [x, y], [x + width, y]),
    strokeOpts(borders.bottom, [x, y + height], [x + width, y + height]),
    strokeOpts(borders.left, [x, y], [x, y + height]),
    strokeOpts(borders.right, [x + width, y], [x + width, y + height]),
  ].filter(Boolean) as Array<Record<string, unknown>>;
  for (const line of lines) {
    (cell as unknown as { addShape: (t: string, cfg: Record<string, unknown>) => unknown })
      .addShape('line', { attrs: line });
  }
}
```

> 说明：`addShape` 是 S2 cell 公开 API（G 图形工厂）；若 v2 中签名不同（如 `this.addShape('rect', { style: {...} })`），以 `.d.ts` 为准调整 attrs/style 字段名。`PreviewModel` 需在 Task 8 补 `styles: Record<string, ResolvedStyle>` 字段（由 schema.styles 直通，transform 已持有 schema）。

- [ ] **Step 5: 定义单元格子类**

```ts
export class ReportDataCell extends DataCell {
  initCell() {
    // 由 PreviewSheet 注入 lookup
    const lookup = (this.spreadsheet as unknown as { __cellLookup?: CellStyleLookup }).__cellLookup;
    if (lookup) drawSurface(this as unknown as Parameters<typeof drawSurface>[0], lookup);
    super.initCell();
  }
}
// ReportRowCell / ReportColCell 同构；行头还需读 indent（Indent>0 时文本左移）
```

> 行头缩进：在 `drawTextShape` 流程中，`getMeta()` 返回 `x/y/width/height`，通过修改 meta 的 x（`meta.x += indent * 10`）再调 `super.drawTextShape()` 实现（S2 文本定位基于 meta）。若 v2 在 `drawTextShape` 前拷贝 meta，则改为覆写 `getTextPosition` 或绘制前 `meta.cellId` 查找——以实际行为为准，浏览器验收时校正。

- [ ] **Step 6: 跑通编译**

Run: `npx tsc -b`
Expected: 通过（无类型错误）。若 S2 类型缺失报错，按 `.d.ts` 修正导入路径。

- [ ] **Step 7: 真实渲染冒烟（浏览器 demo 验证格子可见）**

在 Task 9 前的临时验证页（临时在 `App.tsx` 路由后追加 `/s2demo` 页或用现有 `/editor` 临时替换），运行 `npm run dev` 后：

```bash
agent-browser open http://localhost:5173/editor/rpt_sales
agent-browser screenshot /tmp/s2-demo.png
```

打开截图确认：底色/边框/文字可见、无白屏、控制台无关键报错（`agent-browser` 观察控制台可用 `get_console_message`/Chrome DevTools MCP）。本步结果记录到 commit message。**若渲染异常，回到 Step 4/5 按 `.d.ts` 修正后再验**。

- [ ] **Step 8: Commit**

```bash
git add src/s2/customCells.ts src/s2/s2Theme.ts src/s2/customCells.test.ts
git commit -m "feat(web): per-cell style rendering via custom cells"
```

---

### Task 8: PreviewSheet 组件集成 + 事件映射 + 缩放 + 测试环境

**Files:**
- Modify: `src/test-setup.ts`（canvas/ResizeObserver stub）
- Create: `src/s2/PreviewSheet.tsx`
- Test: `src/s2/PreviewSheet.test.tsx`

- [ ] **Step 1: 测试环境 stub**

```ts
// src/test-setup.ts 追加（文件已存在，追加到末尾）
import type { Mock } from 'vitest';

// jsdom 无 canvas/ResizeObserver：@antv/g 渲染需要，提供最小 stub
const ctxStub = new Proxy({}, {
  get: (_t, k) => (k === 'canvas' ? null : () => {}),
}) as unknown as CanvasRenderingContext2D;
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub as unknown as RenderingContext);
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}
```

- [ ] **Step 2: 写失败测试**

```tsx
// src/s2/PreviewSheet.test.tsx
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSchema } from '../api/mock';
import PreviewSheet from './PreviewSheet';

const onSelect = vi.fn();

describe('PreviewSheet', () => {
  it('pivot 挂载不抛错，渲染容器存在', () => {
    const { container } = render(<PreviewSheet schema={fixtureSchema} onSelect={onSelect} />);
    expect(container.querySelector('[data-testid="preview-sheet"]')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run src/s2/PreviewSheet.test.tsx`
Expected: FAIL（找不到模块）

- [ ] **Step 4: 实现 PreviewSheet**

```tsx
// src/s2/PreviewSheet.tsx
import { useMemo } from 'react';
import { SheetComponent, type SheetComponentOptions } from '@antv/s2-react';
import '@antv/s2-react/dist/s2-react.min.css';
import type { _ViewMeta } from '@antv/s2';
import type { RenderSchema } from '../api/types';
import { buildPreview, type PreviewModel } from './transform';
import type { PreviewHierarchyType } from './hierarchy';
import { ReportDataCell, ReportRowCell, ReportColCell, makeCellLookup, type CellStyleLookup } from './customCells';

interface Props {
  schema: RenderSchema;
  hierarchyType?: PreviewHierarchyType;
  selectedCell?: string | null;
  zoom?: number;
  onSelect?: (cellId: string) => void;
}

export default function PreviewSheet({ schema, hierarchyType = 'grid', zoom = 1, onSelect }: Props) {
  const model = useMemo(() => buildPreview(schema, hierarchyType), [schema, hierarchyType]);
  const lookup = useMemo<CellStyleLookup>(() => makeCellLookup(model), [model]);

  const options = useMemo<SheetComponentOptions>(() => ({
    ...model.options,
    dataCell: (viewMeta: _ViewMeta, s2) => new ReportDataCell(viewMeta, s2),
    rowCell: (node, s2, headerConfig) => new ReportRowCell(node, s2, headerConfig),
    colCell: (node, s2, headerConfig) => new ReportColCell(node, s2, headerConfig),
    // 让自定义 cell 拿回 cell_id：经 layoutCellMeta 附加
    layoutCellMeta: (_meta: _ViewMeta, sheetType) => {
      const m = _meta as _ViewMeta & { __cellId?: string };
      m.__cellId = resolveCellId(model, _meta.rowIndex ?? -1, fieldOf(_meta), sheetType === 'table');
      return m;
    },
  }), [model]);

  const selectCell = (cellId?: string) => { if (cellId && onSelect) onSelect(cellId); };

  const handleDataClick = (viewMeta: { cell: { getMeta(): _ViewMeta } }) => {
    selectCell(viewMeta.cell.getMeta().__cellId);
  };
  const handleRowClick = (viewMeta: { cell: { getMeta(): _ViewMeta } }) => {
    selectCell(viewMeta.cell.getMeta().__cellId);
  };
  const handleColClick = (viewMeta: { cell: { getMeta(): _ViewMeta } }) => {
    selectCell(viewMeta.cell.getMeta().__cellId);
  };

  return (
    <div
      data-testid="preview-sheet"
      style={{
        width: `${100 / zoom}%`, height: `${100 / zoom}%`,
        transform: `scale(${zoom})`, transformOrigin: 'top left',
      }}
    >
      <SheetComponent
        sheetType={model.sheetType}
        dataCfg={model.dataCfg}
        options={options}
        themeCfg={{ theme: undefined }}
        adaptive
        onDataCellClick={handleDataClick}
        onRowCellClick={handleRowClick}
        onColCellClick={handleColClick}
      />
    </div>
  );
}

// --- 辅助：把 S2 行列坐标映射回 cell_id ---
function fieldOf(vm: _ViewMeta): string {
  return (vm as unknown as { valueField?: string; field?: string }).valueField ??
    ((vm as unknown as { field?: string }).field ?? '');
}

function resolveCellId(model: PreviewModel, rowIndex: number, field: string, isTable: boolean): string | undefined {
  const rec = model.records[rowIndex === -1 ? 0 : rowIndex];
  if (!rec) return undefined;
  if (field === '__isTotal') return undefined;
  // 数据格：指标字段
  if (model.sheetType === 'pivot' && field !== '' && field in rec.__cellIds) return rec.__cellIds[field];
  if (model.sheetType === 'table') {
    // table sheet：列字段就是指标字段
    if (field in rec.__cellIds) return rec.__cellIds[field];
    return undefined;
  }
  // 行头格：维度字段
  return rec.__dimCellIds[field] ?? undefined;
}
```

> 说明：S2 v2 的 `_ViewMeta` 为数据格元类型；行头格 `viewMeta.cell.getMeta()` 返回 `Node` 形态（含 `field`/`value`/`rowIndex`）。`rowIndex` 对总计行可能为 `-1`/特殊值，映射仅用于回溯，查不到就跳过。`fieldOf` 兼容数据格（`valueField`）与行头格（`field`）。若 v2 事件回调签名不同（如回调参数为 `{ cell: { getMeta } }`），以 `.d.ts` 为准；事件名以 `@antv/s2-react` v2 的 Props 为准（Task 9 的 EditorLayout 测试会兜底校验挂载）。

> **styles 字段**：Task 8 在 `buildPreview` 返回值补 `styles: schema.styles`（一行）。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/s2/PreviewSheet.test.tsx`
Expected: PASS（挂载不抛错）

- [ ] **Step 6: 真实渲染冒烟（同 Task 7 Step 7 流程，预览行头/数据/条件格式可见）**

```bash
agent-browser open http://localhost:5173/editor/rpt_sales && agent-browser screenshot /tmp/s2-preview.png
```

Expected：表格渲染出维度列/指标列/小计总计行；截图人工核验无大面积空白。若事件名/元数据字段不符，修正本任务代码。

- [ ] **Step 7: Commit**

```bash
git add src/test-setup.ts src/s2/PreviewSheet.tsx src/s2/PreviewSheet.test.tsx src/s2/transform.ts
git commit -m "feat(web): PreviewSheet s2 wrapper with cell-id back-mapping and zoom"
```

---

### Task 9: 接入 EditorLayout + 形态切换 UI + 草稿持久化

**Files:**
- Modify: `src/editor/EditorLayout.tsx`
- Modify: `src/editor/EditorLayout.test.tsx`
- Test: `src/editor/EditorLayout.test.tsx`（更新）

- [ ] **Step 1: 更新 EditorLayout（替换画布 + 加形态 Segmented）**

`src/editor/EditorLayout.tsx` 变更点：
- 删除 `import PreviewCanvas from './PreviewCanvas';`，新增：
  ```tsx
  import PreviewSheet from '../s2/PreviewSheet';
  import { getPreview, setPreview, PREVIEW_HIERARCHY_TYPES, type PreviewHierarchyType } from '../s2/hierarchy';
  import { Segmented } from 'antd';
  ```
- store 中取 `draft`（已取），计算 `const previewCfg = getPreview(draft as Record<string, unknown> | null);`。
- 画布区替换为：
  ```tsx
  {render ? (
    <PreviewSheet schema={render} hierarchyType={previewCfg.hierarchy_type} selectedCell={selectedCell} onSelect={selectCell} zoom={zoom} />
  ) : ( /* 原有"暂无预览"占位保留 */ )}
  ```
- 工具条（`ate-canvas-bar`，位于"实时预览"标题区右侧）加形态切换：
  ```tsx
  <Segmented
    size="small"
    options={PREVIEW_HIERARCHY_TYPES.map((t) => ({ label: t, value: t }))}
    value={previewCfg.hierarchy_type}
    onChange={(v) => {
      const next = v as PreviewHierarchyType;
      if (next === previewCfg.hierarchy_type) return;
      const s = useEditorStore.getState();
      s.checkpoint(`切换预览形态 ${next}`);
      s.mutateDraft((d) => { setPreview(d as Record<string, unknown>, { hierarchy_type: next }); });
    }}
  />
  ```
- 行/列数提示、zoom、选中条、撤销等逻辑不变。

- [ ] **Step 2: 更新 EditorLayout.test.tsx**

- 顶部 `vi.mock('../s2/PreviewSheet', ...)`：
  ```tsx
  vi.mock('../s2/PreviewSheet', () => ({
    default: (props: { schema?: unknown; onSelect?: (c: string) => void }) => (
      <div data-testid="preview-sheet-mock">{(props.schema as { report?: { row_total?: number } })?.report?.row_total ?? ''}</div>
    ),
  }));
  ```
- 第三个用例的 `screen.getAllByText('大区')` 断言替换为：
  ```tsx
  await waitFor(() => { expect(screen.getByTestId('preview-sheet-mock')).toBeTruthy(); });
  expect(screen.getByText(/11 ROWS/)).toBeTruthy();
  ```
- 新增用例：切换 Segmented 写回草稿：
  ```tsx
  test('hierarchy segmented persists preview.hierarchy_type into draft', async () => {
    render(<MemoryRouter initialEntries={['/editor/rpt_sales']}><Routes><Route path="/editor/:id" element={<EditorLayout />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(useEditorStore.getState().draft).not.toBeNull());
    const seg = screen.getByText('tree');
    fireEvent.click(seg);
    await waitFor(() => {
      const d = useEditorStore.getState().draft as unknown as { preview?: { hierarchy_type?: string } };
      expect(d.preview?.hierarchy_type).toBe('tree');
    });
  });
  ```

- [ ] **Step 3: 运行确认通过**

Run: `npx vitest run src/editor/EditorLayout.test.tsx`
Expected: PASS（原有用例适配后全绿 + 新用例通过）

- [ ] **Step 4: 全量单测**

Run: `npm test`
Expected: 现有测试全绿（Task 10 尚未删除旧画布，PreviewCanvas.test.tsx 仍存在且应继续通过）

- [ ] **Step 5: 浏览器验收（形态切换效果 + 草稿持久化）**

```bash
agent-browser open http://localhost:5173/editor/rpt_sales
agent-browser screenshot /tmp/s2-grid.png
agent-browser find text "tree" click
agent-browser screenshot /tmp/s2-tree.png
```

Expected：grid 下维度列独立+合并；切 tree 后单列缩进层级展开可折叠；刷新后形态保持（草稿持久化）。人工核验截图。

- [ ] **Step 6: Commit**

```bash
git add src/editor/EditorLayout.tsx src/editor/EditorLayout.test.tsx
git commit -m "feat(web): integrate s2 preview sheet and configurable hierarchy in editor"
```

---

### Task 10: 清理旧画布

**Files:**
- Delete: `src/editor/PreviewCanvas.tsx`, `src/editor/PreviewCanvas.test.tsx`, `src/editor/StyleSheet.ts`, `src/editor/StyleSheet.test.ts`
- Verify: `src/editor/conditional.ts`（保留，transform 复用）

- [ ] **Step 1: 确认无残留引用**

Run: `grep -rn "PreviewCanvas\|StyleSheet\|styleSheetCSS" src --include="*.ts*"`（用 Grep 工具）
Expected: 仅命中 `src/editor/conditional.ts`（引用自身）或无命中。若有 EditorLayout 残留引用，回 Task 9 修复。

- [ ] **Step 2: 删除文件**

```bash
git rm src/editor/PreviewCanvas.tsx src/editor/PreviewCanvas.test.tsx src/editor/StyleSheet.ts src/editor/StyleSheet.test.ts
```

- [ ] **Step 3: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全绿；tsc 无未使用导出报错。若 `conditional.ts` 的 `row.map`/`parseRange` 等被删文件独享导致类型松动，不动它（仍被 transform 使用）。

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(web): remove legacy preview canvas and style sheet module"
```

---

### Task 11: 浏览器验收回归 + 收尾

**Files:** 无（验收性质）

- [ ] **Step 1: 启动 dev server**

Run（后台）: `npm run dev`
Expected: Vite 启动，端口 5173（用 CheckCommandStatus 确认无报错）。

- [ ] **Step 2: 验收清单（agent-browser / Chrome DevTools MCP 逐项）**

```bash
agent-browser open http://localhost:5173/editor/rpt_sales
agent-browser screenshot /tmp/final-grid.png
```

1. grid：维度列独立 + 纵向合并（区域/城市）、小计/总计行、表头样式、指标右对齐、数据条条件格式可见；
2. 点击数据格 → 右侧检查器出现 cell_id 与"样式解释/数据血缘"（回查 mock 接口 200）；
3. 切 tree / grid-tree：行头层级、展开/收起正常；
4. 缩放 100%→125%→75% 无布局崩坏；
5. 撤销/重做、主题套用、发布、导出按钮可用（发布/导出走 mock 成功提示）；
6. 控制台无未捕获错误（`agent-browser get_console_message` 或 DevTools MCP `list_console_messages`）。

- [ ] **Step 3: 全量回归**

Run: `npm test && npm run build`
Expected: 全绿。再跑 Go 侧 `cd ../dynamic-report && go test ./...` 确认后端未受影响。

- [ ] **Step 4: 最终 commit（如有收尾改动）**

```bash
git add -A
git commit -m "chore(web): finalize s2 preview editor migration"
```

---

## Self-Review

**Spec 覆盖：**
- 适配层/架构 → Task 2-6（transform）+ Task 7-8（渲染）
- 逐格保真 → Task 7（customCells/s2Theme）
- 条件格式 → Task 5
- 合并 → Task 4（dimMerges）+ Task 8 数据区 mergedCellsInfo（transform 里 dimMerges 已含；数据区合并属稀有，Story 覆盖在 Task 4 的通用 helper 中）
- 0 维度回退 → Task 6
- 形态配置与持久化 → Task 1（helpers）+ Task 9（UI）
- 交互闭环（选中→检查器）→ Task 8/9 + Task 11 验收
- 删除旧画布 → Task 10
- 风险 R1（v2 API 差异）→ Task 7/8 的"以 .d.ts 为准"步骤与 Task 11 浏览器验收

**占位符扫描：** 无 TODO/TBD；Step 7/验收步骤均给了命令与预期输出。`layoutCellMeta` 附加 `__cellId` 的方式与 `resolveCellId` 涉及 S2 v2 内部 `_ViewMeta` 结构，属实现期验证点，已在步骤中显式要求对照 `.d.ts` 校正，不属于省略内容。

**类型一致性：** `PreviewModel`（transform 返回）在 Task 4 增加 `dimMerges`/`headerStyles`、Task 8 增加 `styles`/`records` 已使用；`PreviewRecord` 的维度键在 Task 2/3 统一为 `dim_${col.idx}` 或 fixture 原生键（以失败测试驱动落地）；`PreviewHierarchyType` 由 `hierarchy.ts` 导出并在 transform/PreviewSheet/EditorLayout 复用；`buildPreview(schema, hierarchyType)` 签名全链一致。