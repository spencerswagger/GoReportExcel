import type { S2DataConfig, RawData } from '@antv/s2';
import type { SheetComponentOptions } from '@antv/s2-react';
import type { RenderSchema, RowDTO, ColInfo } from '../api/types';
import type { PreviewHierarchyType } from './hierarchy';

export interface PreviewRecord extends Record<string, unknown> {
  __row: { idx: number; type: RowDTO['type'] };
  __display: Record<string, string>;
  __cellIds: Record<string, string>;
  __dimCellIds: Record<string, string>;
}

// 将 RenderSchema 的平铺行列重建为 S2 数据模型（fields + data + meta）
// hierarchyType 本任务暂不使用，T4 起用于层级展示，故保留在签名中
const dimKey = (col: ColInfo): string => col.metric ?? `dim_${col.idx}`;

export function buildPreview(
  schema: RenderSchema,
  _hierarchyType: PreviewHierarchyType = 'grid',
): {
  dataCfg: S2DataConfig;
  options: SheetComponentOptions;
  records: PreviewRecord[];
  sheetType: 'pivot' | 'table';
} {
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
        const v = cell.value;
        const omitDim = row.type === 'total' || (v === '' || v === null || v === undefined);
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
    options: {},
    records,
    sheetType,
  };
}