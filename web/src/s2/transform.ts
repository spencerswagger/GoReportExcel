import type { S2DataConfig, RawData } from '@antv/s2';
import type { SheetComponentOptions } from '@antv/s2-react';
import type { RenderSchema, RowDTO, ColInfo } from '../api/types';
import { colorScaleColor, topNHitIds } from '../editor/conditional';
import type { PreviewHierarchyType } from './hierarchy';

// 条件格式条目：scope 为前端扩展字段（后端 CFInfo 不含 metric，无 scope 时回退到第一条指标列）
type CFWithScope = (NonNullable<RenderSchema['conditional_formats']>[number]) & { scope?: { metric?: string } };

export interface PreviewRecord extends Record<string, unknown> {
  __row: { idx: number; type: RowDTO['type'] };
  __display: Record<string, string>;
  __cellIds: Record<string, string>;
  __dimCellIds: Record<string, string>;
}

// 将 RenderSchema 的平铺行列重建为 S2 数据模型（fields + data + meta）
// hierarchyType 本任务暂不使用，T4 起用于层级展示，故保留在签名中
const dimKey = (col: ColInfo): string => col.metric ?? `dim_${col.idx}`;

// 维度合并：把 Excel 1-based 合并区间映射为 bodyRows 的 record 索引区间
export interface DimMerge {
  level: number;
  from: number;
  to: number;
  anchorCellId: string;
}

function buildDimMerges(
  schema: RenderSchema,
  dimCols: ColInfo[],
  bodyRows: RowDTO[],
): DimMerge[] {
  // record 索引 = bodyRows 内的位置（0-based），锚定到物理行 idx
  const idxToRecord = new Map<number, number>();
  bodyRows.forEach((r, i) => idxToRecord.set(r.idx, i));
  // level 与维度列在 cols 中的顺序一致（0,1,...）
  const levelByCol = new Map<number, number>();
  dimCols.forEach((c, i) => levelByCol.set(c.idx, i));

  const out: DimMerge[] = [];
  for (const m of schema.merges ?? []) {
    const colIdx0 = m.c - 1; // Excel 1-based → 0-based
    const lvl = levelByCol.get(colIdx0);
    if (lvl === undefined) continue; // 数据区合并本任务不处理（留给后续）
    const from = idxToRecord.get(m.r1);
    const to = idxToRecord.get(m.r2);
    if (from === undefined || to === undefined || from > to) continue;
    const anchor = bodyRows[from].cells.find((c) => c.col === colIdx0);
    out.push({ level: lvl, from, to, anchorCellId: anchor?.cell_id ?? '' });
  }
  return out;
}

// 表头字段 → styleId 映射（dimKey 保证与数据键一致）
function buildHeaderStyles(schema: RenderSchema): Record<string, string> {
  const header = schema.rows.find((r) => r.type === 'header');
  const map: Record<string, string> = {};
  if (!header) return map;
  for (const cell of header.cells) {
    const col = schema.cols[cell.col];
    if (!col) continue;
    map[dimKey(col)] = cell.style;
  }
  return map;
}

// 将后端条件格式 CFInfo 映射为 S2 conditions（text 右对齐 + interval 数据条 + background 色阶/前 N）
function buildConditions(
  schema: RenderSchema,
  records: PreviewRecord[],
): SheetComponentOptions['conditions'] {
  const metricCols = schema.cols.filter((c) => c.role === 'metric');
  const text: Array<{ field: string; mapping: () => { textAlign: 'right' } }> = metricCols.map((c) => ({
    field: c.metric as string,
    mapping: () => ({ textAlign: 'right' }),
  }));
  const interval: Array<{
    field: string;
    mapping: (v: number | string) => { fill: string; isCompare: boolean; minValue: number; maxValue: number };
  }> = [];
  const background: Array<{
    field: string;
    mapping: (v: number | string, data?: Record<string, unknown>) => { fill: string } | null;
  }> = [];

  // 定位 CF 作用的指标字段：scope.metric 优先，缺失时回退到第一条指标列
  const metricFieldOf = (metric?: string) => metricCols.find((c) => c.metric === metric)?.metric;

  for (const raw of schema.conditional_formats ?? []) {
    const cf = raw as CFWithScope;
    const field = metricFieldOf(cf.scope?.metric) ?? metricCols[0]?.metric;
    if (!field) continue;
    if (cf.kind === 'data_bar' && cf.stats) {
      const { min, max } = cf.stats;
      const color = cf.color ?? '#638EC6';
      interval.push({ field, mapping: () => ({ fill: color, isCompare: true, minValue: min, maxValue: max }) });
    } else if (cf.kind === 'color_scale' && cf.stats && cf.color) {
      const stats = { min: cf.stats.min, max: cf.stats.max };
      const color = cf.color;
      background.push({
        field,
        mapping: (v: number | string) =>
          typeof v === 'number' ? { fill: colorScaleColor(v, stats, '#FFFFFF', color).toUpperCase() } : null,
      });
    } else if (cf.kind === 'top_n' && cf.n && cf.n > 0) {
      const fill = cf.style?.fill?.color ?? '#FDEBD0';
      const cells = records
        .filter((r) => typeof r[field] === 'number')
        .map((r, i) => ({ idx: i, cellId: String(r.__cellIds[field] ?? ''), value: Number(r[field]) }));
      const hitIds = new Set(topNHitIds(cells, cf.n));
      background.push({
        field,
        mapping: (_v: number | string, data?: Record<string, unknown>) => {
          const rec = data as PreviewRecord | undefined;
          const cellId = rec?.__cellIds[field];
          return cellId && hitIds.has(cellId) ? { fill } : null;
        },
      });
    }
  }
  return { text, interval, background };
}

export interface PreviewModel {
  dataCfg: S2DataConfig;
  options: SheetComponentOptions;
  records: PreviewRecord[];
  sheetType: 'pivot' | 'table';
  dimMerges: DimMerge[];
  headerStyles: Record<string, string>;
}

export function buildPreview(
  schema: RenderSchema,
  _hierarchyType: PreviewHierarchyType = 'grid',
): PreviewModel {
  const dimCols = schema.cols.filter((c) => c.role === 'dimension');
  const metricCols = schema.cols.filter((c) => c.role === 'metric');
  const bodyRows = schema.rows.filter((r) => r.type !== 'header');

  // 维度键：有 metric 用 metric，否则用 dim_<列序号>（fixture 维度列无 metric → dim_0/dim_1）

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
      const key = dimKey(col);
      rec.__display[key] = cell.display;
      if (col.role === 'metric') {
        rec[key] = cell.value;
        rec.__cellIds[key] = cell.cell_id;
      } else {
        rec.__dimCellIds[key] = cell.cell_id;
        // data-provided totals 语法：total 行省略全部维度键；subtotal 行省略空值维度键
        // detail 行即使维度值为空也照常写入，避免 S2 依据"键缺失"误判行为小计
        const v = cell.value;
        const omitDim = row.type !== 'detail' && (row.type === 'total' || v === '' || v === null || v === undefined);
        if (!omitDim) rec[key] = v;
      }
    }
    return rec;
  });

  const fields = {
    rows: dimCols.map(dimKey),
    columns: [] as string[],
    values: metricCols.map((c) => c.metric as string),
  };

  const meta = [
    ...dimCols.map((c) => ({ field: dimKey(c), name: c.label })),
    ...metricCols.map((c) => ({
      field: c.metric as string,
      name: c.label,
      formatter: (v: unknown, d?: Record<string, unknown>) => {
        const rec = d as PreviewRecord | undefined;
        const key = c.metric as string;
        return rec?.__display?.[key] ?? (v === null || v === undefined ? '' : String(v));
      },
    })),
  ];

  const sheetType: 'pivot' | 'table' = fields.rows.length === 0 ? 'table' : 'pivot';

  return {
    dataCfg: { data: records as unknown as RawData[], fields, meta },
    // hierarchyType 供层级展示使用；指标列默认右对齐，条件格式映射为 S2 conditions
    options: {
      hierarchyType: _hierarchyType,
      conditions: buildConditions(schema, records),
    },
    records,
    sheetType,
    dimMerges: buildDimMerges(schema, dimCols, bodyRows),
    headerStyles: buildHeaderStyles(schema),
  };
}