import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { setupWorker, type SetupWorkerApi } from 'msw/browser';
import type { CellDTO, RenderSchema, RowDTO } from './types';

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
// handlers — 全部挂在 '*/api/v1/...' 下
// ---------------------------------------------------------------------------

const handlers = [
  http.get('*/api/v1/definitions/:id/draft', ({ params }) =>
    HttpResponse.json({ version: 2, payload: JSON.stringify({ id: params.id, version: 2 }) }),
  ),

  http.put('*/api/v1/definitions/:id/draft', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { version?: number };
    if (body.version === 1) {
      return HttpResponse.json({ error: 'draft conflict: base version outdated' }, { status: 409 });
    }
    return HttpResponse.json({ ok: 'saved' });
  }),

  http.post('*/api/v1/definitions/:id/publish', () =>
    HttpResponse.json({ ok: 'published' }),
  ),

  http.get('*/api/v1/definitions/:id/versions', () =>
    HttpResponse.json([
      { version: 2, status: 'published', updated_by: 'api', updated_at: '2026-09-05T00:00:00Z' },
      { version: 1, status: 'draft', updated_by: 'api', updated_at: '2026-09-04T00:00:00Z' },
    ]),
  ),

  http.post('*/api/v1/definitions/:id/rollback', () =>
    HttpResponse.json({ ok: 'rolled back' }),
  ),

  http.patch('*/api/v1/definitions/:id/overrides', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { override?: { id?: string } };
    const oid = body.override?.id ?? 'X';
    return HttpResponse.json({ ok: `override ${oid} updated` });
  }),

  http.post('*/api/v1/render', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { row_window?: { from: number; to: number } };
    const schema = structuredClone(fixtureSchema);
    if (body.row_window) {
      const { from, to } = body.row_window;
      schema.rows = schema.rows.slice(Math.max(0, from - 1), to);
    }
    return HttpResponse.json({ version: fixtureSchema.report.def_version, schema });
  }),

  http.get('*/api/v1/cells/:cellId/style-explain', ({ params }) =>
    HttpResponse.json({
      cell_id: params.cellId,
      explains: [{ id: 'zebra', reason: 'row_type eq "detail" and seq_in_group % 2 eq 0' }],
      style: { Bold: false, Fill: '#F5F7FA' },
    }),
  ),

  http.get('*/api/v1/cells/:cellId/data-trace', ({ params }) =>
    HttpResponse.json({
      cell_id: params.cellId,
      trace: { source_count: 2, sample_rows: [1, 2] },
      type: 'subtotal',
      formula: '=SUBTOTAL(9,C2:C3)',
    }),
  ),

  http.post('*/api/v1/export', () =>
    HttpResponse.json({ task_id: 'task-1', def_version: 2 }),
  ),

  http.get('*/api/v1/export/:taskId', () =>
    HttpResponse.json({ id: 'task-1', state: 'done', progress: 1, updated_at: '2026-09-05T00:00:01Z' }),
  ),
];

// ---------------------------------------------------------------------------
// server (node) / worker (browser) / enableMocking
// ---------------------------------------------------------------------------

export const server = setupServer(...handlers);

// setupWorker 内部通过 isNodeProcess() 校验，在 vitest/node 环境直接调用会抛错，
// 故仅在浏览器（非 node）环境创建 worker；测试环境 worker 为 undefined。
const isNodeProcess =
  typeof process !== 'undefined' && !!process.versions?.node;

export const worker: SetupWorkerApi | undefined = isNodeProcess
  ? undefined
  : setupWorker(...handlers);

export async function enableMocking() {
  if (import.meta.env.DEV && worker) {
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
}
