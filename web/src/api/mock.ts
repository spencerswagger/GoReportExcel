import { http, HttpResponse } from 'msw';
import type { CellDTO, MergeInfo, RenderSchema, RowDTO } from './types';

// ---------------------------------------------------------------------------
// fixtureSchema — 单分组报表（2 维度：大区/城市，3 个城市分组，共 11 行）
// 供 PreviewCanvas / Inspector / EditorLayout 等后续任务复用，需与计划一致。
// ---------------------------------------------------------------------------

const headerCells: CellDTO[] = [
  { col: 0, cell_id: 'r1c0', value: '大区', display: '大区', style: 's1' },
  { col: 1, cell_id: 'r1c1', value: '城市', display: '城市', style: 's1' },
  { col: 2, cell_id: 'r1c2', value: '销售额', display: '销售额', style: 's1' },
  { col: 3, cell_id: 'r1c3', value: '件数', display: '件数', style: 's1' },
];

function detailCells(idx: number, region: string, city: string, amount: number, qty: number): CellDTO[] {
  return [
    { col: 0, cell_id: `r${idx}c0`, value: region, display: region, style: 's2' },
    { col: 1, cell_id: `r${idx}c1`, value: city, display: city, style: 's2' },
    { col: 2, cell_id: `r${idx}c2`, value: amount, display: amount.toFixed(2), style: 's2' },
    { col: 3, cell_id: `r${idx}c3`, value: qty, display: String(qty), style: 's2' },
  ];
}

function subtotalCells(idx: number, city: string, amount: number, qty: number, formula: string): CellDTO[] {
  return [
    { col: 0, cell_id: `r${idx}c0`, value: '', display: '', style: 's3' },
    { col: 1, cell_id: `r${idx}c1`, value: city, display: city, style: 's3' },
    { col: 2, cell_id: `r${idx}c2`, value: amount, display: amount.toFixed(2), formula, style: 's3' },
    { col: 3, cell_id: `r${idx}c3`, value: qty, display: String(qty), style: 's3' },
  ];
}

function totalCells(idx: number, amount: number, qty: number, formula: string): CellDTO[] {
  return [
    { col: 0, cell_id: `r${idx}c0`, value: '总计', display: '总计', style: 's3' },
    { col: 1, cell_id: `r${idx}c1`, value: '', display: '', style: 's3' },
    { col: 2, cell_id: `r${idx}c2`, value: amount, display: amount.toFixed(2), formula, style: 's3' },
    { col: 3, cell_id: `r${idx}c3`, value: qty, display: String(qty), style: 's3' },
  ];
}

const rows: RowDTO[] = [
  { idx: 1, type: 'header', cells: headerCells },
  { idx: 2, type: 'detail', group_path: ['华东', '上海'], seq: 1, cells: detailCells(2, '华东', '上海', 100, 1) },
  { idx: 3, type: 'detail', group_path: ['华东', '上海'], seq: 2, cells: detailCells(3, '华东', '上海', 200, 1) },
  { idx: 4, type: 'subtotal', group_path: ['华东', '上海'], cells: subtotalCells(4, '上海', 300, 2, '=SUBTOTAL(9,C2:C3)') },
  { idx: 5, type: 'detail', group_path: ['华东', '杭州'], seq: 1, cells: detailCells(5, '华东', '杭州', 150, 1) },
  { idx: 6, type: 'detail', group_path: ['华东', '杭州'], seq: 2, cells: detailCells(6, '华东', '杭州', 150, 1) },
  { idx: 7, type: 'subtotal', group_path: ['华东', '杭州'], cells: subtotalCells(7, '杭州', 300, 2, '=SUBTOTAL(9,C5:C6)') },
  { idx: 8, type: 'detail', group_path: ['华东', '南京'], seq: 1, cells: detailCells(8, '华东', '南京', 200, 1) },
  { idx: 9, type: 'detail', group_path: ['华东', '南京'], seq: 2, cells: detailCells(9, '华东', '南京', 200, 1) },
  { idx: 10, type: 'subtotal', group_path: ['华东', '南京'], cells: subtotalCells(10, '南京', 400, 2, '=SUBTOTAL(9,C8:C9)') },
  { idx: 11, type: 'total', cells: totalCells(11, 1000, 5, '=SUBTOTAL(9,C2:C10)') },
];

export const fixtureSchema: RenderSchema = {
  schema_version: 1,
  report: { id: 'rpt_sales', def_version: 2, row_total: 11 },
  cols: [
    { idx: 0, role: 'dimension', label: '大区', width: 90, align: 'left' },
    { idx: 1, role: 'dimension', label: '城市', width: 90, align: 'left' },
    { idx: 2, role: 'metric', label: '销售额', width: 120, align: 'right', num_fmt: '#,##0.00', metric: 'amount' },
    { idx: 3, role: 'metric', label: '件数', width: 80, align: 'right', num_fmt: '#,##0', metric: 'qty' },
  ],
  styles: {
    s1: {
      BorderTop: 'thin', BorderRight: 'thin', BorderBottom: 'thin', BorderLeft: 'thin',
      Fill: '#D9E2F3', FontColor: '#1F2937', Bold: true, RowHeight: 24, Indent: 0,
    },
    s2: {
      BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'hair', BorderLeft: 'hair',
      Fill: '#F5F7FA', FontColor: '#1F2937', Bold: false, RowHeight: 20, Indent: 0,
    },
    s3: {
      BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'medium', BorderLeft: 'hair',
      Fill: '#E8EEF7', FontColor: '#1F2937', Bold: true, RowHeight: 22, Indent: 0,
    },
  },
  merges: [
    { r1: 2, r2: 4, c: 2 },
    { r1: 2, r2: 7, c: 1 },
  ],
  rows,
  page_setup: { orientation: 'landscape', fit_to_width: 1, repeat_header_rows: 1 },
  conditional_formats: [
    { id: 'cf_amount', kind: 'data_bar', color: '#638EC6', ranges: ['C2:C11'], stats: { min: 0, max: 1000 } },
  ],
};

// ---------------------------------------------------------------------------
// 数据源 / 数据集 fixture（供"数据管理"页与编辑器字段池使用）
// ---------------------------------------------------------------------------

export const mockDataSources = [
  { id: 'ds_csv_local', name: '本地 CSV 目录', kind: 'csv', detail: 'csv_local · 按目录扫描 <table>.csv', tables: ['sales.csv', 'employees.csv'] },
  { id: 'ds_dw', name: '数据仓库 PgSQL', kind: 'db', detail: 'postgres://dw · 只读账号', tables: ['dw.sales_fact', 'dw.dim_region'] },
] as const;

export const mockDatasets = [
  {
    id: 'ds_sales',
    name: '销售明细',
    source_ref: 'csv_local',
    source_name: '本地 CSV 目录',
    fields: [
      { key: 'region', type: 'string', label: '大区', sort_key: 'region_order' },
      { key: 'city', type: 'string', label: '城市' },
      { key: 'channel', type: 'string', label: '渠道' },
      { key: 'amount', type: 'number', label: '销售额' },
      { key: 'qty', type: 'number', label: '件数' },
      { key: 'cost', type: 'number', label: '成本' },
      { key: 'order_date', type: 'date', label: '下单日期' },
    ],
    updated_at: '2026-09-05T00:00:00Z',
  },
  {
    id: 'ds_employees',
    name: '员工花名册',
    source_ref: 'csv_local',
    source_name: '本地 CSV 目录',
    fields: [
      { key: 'dept', type: 'string', label: '部门' },
      { key: 'grade', type: 'string', label: '职级' },
      { key: 'headcount', type: 'number', label: '人数' },
      { key: 'salary', type: 'number', label: '薪资' },
    ],
    updated_at: '2026-09-04T00:00:00Z',
  },
];

/** 编辑器演示草稿的默认数据集描述（与 panels.test 的 seededDraft 结构一致） */
const defaultDataset = {
  id: 'ds_sales',
  source_ref: 'csv_local',
  fields: mockDatasets[0].fields.map(({ key, type, label, sort_key }) => ({ key, type, label, sort_key })),
};

const defaultDraftPayload = {
  id: 'rpt_sales',
  version: 2,
  name: '销售报表',
  dataset: defaultDataset,
  dimensions: [
    { field: 'region', label: '大区', sort: { by: 'sort_key', dir: 'asc' } },
    { field: 'city', label: '城市', sort: { by: 'value', dir: 'asc' } },
  ],
  metrics: [
    { field: 'amount', label: '销售额', agg: 'SUM', num_fmt_ref: 'money' },
    { field: 'qty', label: '件数', agg: 'COUNT', num_fmt_ref: 'int' },
  ],
};

// :: 内存草稿缓存：PUT draft 时保存，/v1/render 按最近保存的配置动态生成预览
const draftCache = new Map<string, Partial<typeof defaultDraftPayload>>();

// 动态预览生成的取值域（演示数据）
const DIM_VALUES: Record<string, string[]> = {
  region: ['华东', '华北'],
  city: ['上海', '杭州'],
  channel: ['线上', '门店'],
};

function cartesian(perDim: string[][]): string[][] {
  let acc: string[][] = [[]];
  for (const vals of perDim) {
    acc = acc.flatMap((prefix) => vals.map((v) => [...prefix, v]));
  }
  return acc;
}

/**
 * 按草稿配置（dimensions/metrics/dataset）动态生成 RenderSchema。
 * 仅演示用途：每个维度取 <=2 个取值、每个组合 2 条明细，并生成小计/总计与维度列合并。
 */
function buildMockSchema(payload: Partial<typeof defaultDraftPayload>): RenderSchema {
  const dims = payload.dimensions ?? [];
  const metrics = payload.metrics ?? [];
  const ds = mockDatasets.find((d) => d.id === (payload.dataset as { id?: string } | undefined)?.id) ?? mockDatasets[0];
  const fieldOf = (key: string) => ds.fields.find((f) => f.key === key);

  const perDim: string[][] = dims.map((d) => DIM_VALUES[d.field] ?? [`${d.field}A`, `${d.field}B`]);
  const combos = cartesian(perDim).slice(0, 4);

  const meta: RenderSchema['cols'] = [
    ...dims.map((d, i) => ({
      idx: i, role: 'dimension' as const, label: (fieldOf(d.field)?.label ?? d.label) || d.field,
      width: 96, align: 'left' as const,
    })),
    ...metrics.map((m, i) => ({
      idx: dims.length + i, role: 'metric' as const, label: m.label || m.field,
      width: 120, align: 'right' as const, num_fmt: m.num_fmt_ref === 'money' ? '#,##0.00' : '#,##0', metric: m.field,
    })),
  ];

  let idx = 1;
  const rows: RowDTO[] = [
    { idx: idx++, type: 'header', cells: meta.map((c) => ({ col: c.idx, cell_id: `r1c${c.idx}`, value: c.label, display: c.label, style: 's1' })) },
  ];
  // 记录每个维度列的组合区间，用于生成合并
  const runByCol: Array<{ value: string; from: number; to: number; col0: number }[]> = dims.map(() => []);
  const pushRun = (col0: number, value: string, rowIdx: number) => {
    const run = runByCol[col0];
    const last = run[run.length - 1];
    if (last && last.value === value) last.to = rowIdx;
    else run.push({ value, from: rowIdx, to: rowIdx, col0 });
  };

  for (const combo of combos.map((c) => [...c])) {
    const seg: number[] = [];
    for (let j = 0; j < 2; j++) {
      const rIdx = idx++;
      seg.push(rIdx);
      const cells = meta.map((c) => {
        if (c.role === 'dimension') {
          const v = combo[c.idx];
          pushRun(c.idx, v, rIdx);
          return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: v, style: 's2' };
        }
        const v = 100 * (c.idx + 1) + (rIdx % 3) * 50;
        return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's2' };
      });
      rows.push({ idx: rIdx, type: 'detail' as const, group_path: combo, seq: j + 1, cells });
    }
    const rIdx = idx++;
    seg.push(rIdx);
    pushRun(dims.length - 1, combo[dims.length - 1], rIdx);
    const cells = meta.map((c) => {
      if (c.role === 'dimension') {
        const v = combo[c.idx];
        const last = runByCol[c.idx][runByCol[c.idx].length - 1];
        last.to = rIdx;
        // 小计行只保留最内层维度值，外层留空（便于 S2 省略键判定）
        const show = c.idx === dims.length - 1 ? v : '';
        return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: show, display: show, style: 's3' };
      }
      const v = 100 * (c.idx + 1) * 2;
      return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's3' };
    });
    rows.push({ idx: rIdx, type: 'subtotal' as const, group_path: combo, cells });
  }

  const rIdx = idx++;
  const totalCells = meta.map((c) => {
    if (c.role === 'dimension') {
      const v = c.idx === 0 ? '总计' : '';
      return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: v, style: 's3' };
    }
    const v = 400 * (c.idx + 1);
    return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's3' };
  });
  rows.push({ idx: rIdx, type: 'total' as const, cells: totalCells });

  // 维度列跨组合合并（与 transform.buildDimMerges 配合，语义为列合并而非物理格合并）
  const merges: MergeInfo[] = runByCol.flatMap((runs) =>
    runs.filter((run) => run.from < run.to).map((run) => ({ r1: run.from, r2: run.to, c: run.col0 + 1 })),
  );

  return {
    schema_version: 1,
    report: { id: payload.id ?? 'rpt_sales', def_version: payload.version ?? 2, row_total: rows.length },
    cols: meta,
    styles: {
      s1: { BorderTop: 'thin', BorderRight: 'thin', BorderBottom: 'thin', BorderLeft: 'thin', Fill: '#D9E2F3', FontColor: '#1F2937', Bold: true, RowHeight: 24, Indent: 0 },
      s2: { BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'hair', BorderLeft: 'hair', Fill: '#F5F7FA', FontColor: '#1F2937', Bold: false, RowHeight: 20, Indent: 0 },
      s3: { BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'medium', BorderLeft: 'hair', Fill: '#E8EEF7', FontColor: '#1F2937', Bold: true, RowHeight: 22, Indent: 0 },
    },
    merges,
    rows,
    page_setup: { orientation: 'landscape', fit_to_width: 1, repeat_header_rows: 1 },
    conditional_formats: metrics[0]
      ? [{ id: 'cf_amount', kind: 'data_bar' as const, color: '#638EC6', ranges: [`C2:C${rows.length}`], stats: { min: 0, max: 800 } }]
      : [],
  };
}

// ---------------------------------------------------------------------------
// handlers — 全部挂在 '*/v1/...' 下
// 仅依赖 msw 的 http/HttpResponse，浏览器与 node 环境共用。
// ---------------------------------------------------------------------------

export const handlers = [
  http.get('*/v1/datasources', () =>
    HttpResponse.json(mockDataSources),
  ),

  http.get('*/v1/datasets', () =>
    HttpResponse.json(mockDatasets.map((d) => ({
      id: d.id, name: d.name, source_ref: d.source_ref, source_name: d.source_name,
      field_count: d.fields.length, fields: d.fields, updated_at: d.updated_at,
    }))),
  ),

  http.get('*/v1/datasets/:datasetId', ({ params }) => {
    const ds = mockDatasets.find((d) => d.id === params.datasetId);
    if (!ds) return HttpResponse.json({ error: 'dataset not found' }, { status: 404 });
    return HttpResponse.json(ds);
  }),

  http.get('*/v1/definitions/:id/draft', ({ params }) =>
    HttpResponse.json({
      version: 2,
      payload: JSON.stringify({ ...defaultDraftPayload, id: params.id, name: params.id === 'rpt_sales' ? '销售报表' : '新建报表' }),
    }),
  ),

  http.get('*/v1/definitions/:id/published', ({ params }) =>
    HttpResponse.json({
      version: 2,
      payload: JSON.stringify({ ...defaultDraftPayload, id: params.id, name: params.id === 'rpt_sales' ? '销售报表' : '新建报表' }),
    }),
  ),

  http.put('*/v1/definitions/:id/draft', async ({ request, params }) => {
    const body = await request.json().catch(() => null) as (Partial<typeof defaultDraftPayload> & { version?: number }) | null;
    if (body && typeof body.version === 'number' && body.version <= 1) {
      return HttpResponse.json({ error: 'draft conflict: base version outdated' }, { status: 409 });
    }
    if (body && typeof body === 'object') {
      const prev = draftCache.get(String(params.id)) ?? {};
      draftCache.set(String(params.id), { ...prev, ...body });
    }
    return HttpResponse.json({ ok: 'saved' });
  }),

  http.post('*/v1/definitions/:id/publish', () =>
    HttpResponse.json({ ok: 'published' }),
  ),

  http.get('*/v1/definitions/:id/versions', () =>
    HttpResponse.json([
      { version: 2, status: 'published', updated_by: 'api', updated_at: '2026-09-05T00:00:00Z' },
      { version: 1, status: 'draft', updated_by: 'api', updated_at: '2026-09-04T00:00:00Z' },
    ]),
  ),

  http.post('*/v1/definitions/:id/rollback', () =>
    HttpResponse.json({ ok: 'rolled back' }),
  ),

  http.patch('*/v1/definitions/:id/overrides', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { override?: { id?: string } };
    const oid = body.override?.id ?? 'X';
    return HttpResponse.json({ ok: `override ${oid} updated` });
  }),

  http.post('*/v1/render', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { def_id?: string; row_window?: { from: number; to: number } };
    const payload = draftCache.get(body.def_id ?? '') ?? { ...defaultDraftPayload, id: body.def_id ?? 'rpt_sales' };
    const schema = buildMockSchema(payload);
    if (body.row_window) {
      const { from, to } = body.row_window;
      schema.rows = schema.rows.slice(Math.max(0, from - 1), to);
    }
    return HttpResponse.json({ version: schema.report.def_version, schema });
  }),

  http.get('*/v1/cells/:cellId/style-explain', ({ params }) =>
    HttpResponse.json({
      cell_id: params.cellId,
      explains: [{ id: 'zebra', reason: 'row_type eq "detail" and seq_in_group % 2 eq 0' }],
      style: { Bold: false, Fill: '#F5F7FA' },
    }),
  ),

  http.get('*/v1/cells/:cellId/data-trace', ({ params }) =>
    HttpResponse.json({
      cell_id: params.cellId,
      trace: { source_count: 2, sample_rows: [1, 2] },
      type: 'subtotal',
      formula: '=SUBTOTAL(9,C2:C3)',
    }),
  ),

  http.post('*/v1/export', () =>
    HttpResponse.json({ task_id: 'task-1', def_version: 2 }),
  ),

  http.get('*/v1/export/:taskId', () =>
    HttpResponse.json({ id: 'task-1', state: 'done', progress: 1, updated_at: '2026-09-05T00:00:01Z' }),
  ),
];
