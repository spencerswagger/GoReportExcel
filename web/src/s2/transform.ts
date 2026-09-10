import type { S2DataConfig, SheetComponentOptions } from '@antv/s2';
import type { RenderSchema, RowDTO } from '../api/types';

export interface PreviewRecord extends Record<string, unknown> {
  __row: { idx: number; type: RowDTO['type'] };
  __display: Record<string, string>;
  __cellIds: Record<string, string>;
  __dimCellIds: Record<string, string>;
}

// 将 RenderSchema 的平铺行列重建为 S2 数据模型（fields + data + meta）
// hierarchyType 本任务暂不使用，T4 起用于层级展示，故保留在签名中
export function buildPreview(
  schema: RenderSchema,
  _hierarchyType: 'grid' | 'grid-tree' | 'tree' = 'grid',
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
  const dimKey = (c: { metric?: string; idx: number }) => c.metric ?? `dim_${c.idx}`;

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
        // 小计/总计行的空维度单元格 → 省略键（data-provided totals 语法，T3 细化断言）
        const v = cell.value;
        if (v !== '' && v !== null && v !== undefined) rec[key] = v;
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
    dataCfg: { data: records, fields, meta },
    options: {},
    records,
    sheetType,
  };
}