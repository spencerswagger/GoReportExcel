import { http, HttpResponse } from 'msw';
import type { CellDTO, DataSourceInfo, DatasetFieldInfo, DatasetInfo, RenderSchema, RowDTO } from './types';
import ordersCsvRaw from './fixtures/orders.csv?raw';

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
// 数据源 / 数据集（可变内存仓库：支持数据管理页增删改查）
// 种子数据全部来自真实 CSV 文件（fixtures/orders.csv）解析，不内置任何模拟生成。
// ---------------------------------------------------------------------------

// CSV 上传解析：真实文件 → 表（列字段 + 数据行），供数据集与报表预览消费
const COLUMN_LABELS: Record<string, string> = {
  order_id: '订单号', order_date: '下单日期', region: '大区', city: '城市',
  channel: '渠道', customer: '客户', product: '商品', amount: '金额', qty: '件数',
  dept: '部门', grade: '职级', salary: '薪资', headcount: '人数',
};

function inferType(v: string): DatasetFieldInfo['type'] {
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return 'number';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
  return 'string';
}

interface ParsedTable {
  fields: DatasetFieldInfo[];
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

/** 解析 CSV 文本：首行表头 → 字段（按值推断类型），其余为数据行 */
function parseCsvText(text: string): ParsedTable {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const headers = (lines[0] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== headers.length) continue;
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => { rec[h] = cells[i]; });
    rows.push(rec);
  }
  const fields: DatasetFieldInfo[] = headers.map((h) => {
    const sample = rows.find((r) => String(r[h] ?? '').trim() !== '');
    return { key: h, type: inferType(String(sample?.[h] ?? '')), label: COLUMN_LABELS[h] ?? h };
  });
  return { fields, columns: headers, rows };
}

// ---------------------------------------------------------------------------
// 数据管理页 CRUD：纯内存态（进程内仓库），不使用任何持久化/缓存。
// 刷新页面后恢复种子数据；测试通过 resetMockStore() 隔离。
// ---------------------------------------------------------------------------

/** 测试隔离：恢复种子态（清空新建数据源/表/数据集与草稿缓存） */
export function resetMockStore() {
  dbSources.splice(0, dbSources.length, ...seedSources);
  dbDatasets.splice(0, dbDatasets.length, ...seedDatasetsStored);
  csvTables.clear();
  for (const [sid, tables] of initTables()) csvTables.set(sid, tables);
  draftCache.clear();
}

// 上传的 CSV 表存储：source_id → table 名 → 解析结果
const csvTables = new Map<string, Map<string, ParsedTable>>();
const tableOf = (sourceId: string, table: string) => csvTables.get(sourceId)?.get(table);

// 种子数据：本地 CSV 目录，唯一的表就是真实文件 orders.csv 的解析结果
const seedOrders = parseCsvText(ordersCsvRaw);
const seedSources: DataSourceInfo[] = [
  {
    id: 'csv_local', name: '本地 CSV 目录', kind: 'csv',
    detail: `csv_local · 工作区文件（${seedOrders.rows.length} 行 × ${seedOrders.columns.length} 列）`,
    tables: ['orders.csv'],
  },
];
const seedDatasetsStored: Array<DatasetInfo & { table?: string; sample_rows?: Array<Record<string, unknown>> }> = [
  {
    id: 'ds_sales', name: '销售明细', source_ref: 'csv_local', source_name: '本地 CSV 目录',
    field_count: seedOrders.fields.length, table: 'orders.csv', updated_at: '2026-09-10T00:00:00Z',
    fields: seedOrders.fields,
    sample_rows: seedOrders.rows.slice(0, 10),
  },
];

function initTables(): Map<string, Map<string, ParsedTable>> {
  const m = new Map<string, Map<string, ParsedTable>>();
  m.set('csv_local', new Map([['orders.csv', seedOrders]]));
  return m;
}

const dbSources: DataSourceInfo[] = [...seedSources];
const dbDatasets: Array<DatasetInfo & { table?: string; sample_rows?: Array<Record<string, unknown>> }> = [...seedDatasetsStored];
// 种子表直接挂入表仓库（与 buildMockSchema 的 tableOf 共用），保证种子数据集可预览
for (const [sid, tables] of initTables()) csvTables.set(sid, tables);

export const mockDataSources: DataSourceInfo[] = [...dbSources];

export const mockDatasets: DatasetInfo[] = dbDatasets.map(({ id, name, source_ref, source_name, field_count, fields, updated_at }) => ({
  id, name, source_ref, source_name, field_count, fields, updated_at,
}));

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

// 新建报表的空白草稿：不预置数据集/维度/指标，由用户在编辑器中先选数据集再配置
const blankDraftPayload = {
  id: 'rpt_new',
  version: 2,
  name: '新建报表',
};

const draftFor = (id: string) => (id !== 'rpt_sales' ? { ...blankDraftPayload, id } : defaultDraftPayload);

/**
 * 预览渲染统一入口：数据集必须绑定真实上传的 CSV 表，
 * 用真实行分组聚合（detail 明细 + 小计/总计）；无表或空集时返回空画布。
 */
const SCHEMA_STYLES: RenderSchema['styles'] = {
  s1: { BorderTop: 'thin', BorderRight: 'thin', BorderBottom: 'thin', BorderLeft: 'thin', Fill: '#D9E2F3', FontColor: '#1F2937', Bold: true, RowHeight: 24, Indent: 0 },
  s2: { BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'hair', BorderLeft: 'hair', Fill: '#F5F7FA', FontColor: '#1F2937', Bold: false, RowHeight: 20, Indent: 0 },
  s3: { BorderTop: 'hair', BorderRight: 'hair', BorderBottom: 'medium', BorderLeft: 'hair', Fill: '#E8EEF7', FontColor: '#1F2937', Bold: true, RowHeight: 22, Indent: 0 },
};

function buildMockSchema(payload: Partial<typeof defaultDraftPayload>): RenderSchema {
  const dims = payload.dimensions ?? [];
  const metrics = payload.metrics ?? [];
  const emptySchema: RenderSchema = {
    schema_version: 1,
    report: { id: payload.id ?? 'rpt_new', def_version: payload.version ?? 2, row_total: 1 },
    cols: [],
    styles: {},
    merges: [],
    rows: [{ idx: 1, type: 'header', cells: [] }],
    page_setup: { orientation: 'landscape', fit_to_width: 1, repeat_header_rows: 1 },
    conditional_formats: [],
  };
  if (dims.length === 0 && metrics.length === 0) return emptySchema;
  const ds = dbDatasets.find((d) => d.id === (payload.dataset as { id?: string } | undefined)?.id);
  const parsed = ds ? tableOf(ds.source_ref, ds.table ?? '') : undefined;
  // 只允许基于真实行的聚合渲染：表缺失或为空时给空画布，绝不生成演示假数据
  if (!parsed || parsed.rows.length === 0) return emptySchema;
  return buildFromRealRows(payload, parsed);
}

/** 指标聚合方式：SUM/AVG/MIN/MAX/COUNT（缺省 SUM） */
function aggValue(agg: string, values: number[]): number {
  if (values.length === 0) return 0;
  switch (agg.toUpperCase()) {
    case 'AVG': return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    case 'MIN': return Math.min(...values);
    case 'MAX': return Math.max(...values);
    case 'COUNT': return values.length;
    default: return values.reduce((a, b) => a + b, 0); // SUM
  }
}

/** 真实 CSV 行 → 分组报表：detail 明细直出 + 按行维度小计 + 总计（指标按各自聚合方式汇总；列维度透视为列头） */
function buildFromRealRows(payload: Partial<typeof defaultDraftPayload>, parsed: ParsedTable): RenderSchema {
  // 草稿维度可能来自用户编辑（含 axis），defaultDraftPayload 推导类型不含该字段，这里放宽类型
  type DimensionLike = { field: string; label?: string; axis?: 'row' | 'col'; sort?: { by: string; dir: string } };
  const dimsInput = (payload.dimensions ?? []) as DimensionLike[];
  const rowDims = dimsInput.filter((d) => (d.axis ?? 'row') === 'row');
  const colDims = dimsInput.filter((d) => (d.axis ?? 'row') === 'col');
  const metrics = payload.metrics ?? [];
  const labelOf = (f: string) => parsed.fields.find((x) => x.key === f)?.label ?? f;
  // 表头显示名：优先使用用户在编辑器配置的显示名（指标名/维度名），缺省回退字段 label
  const dimLabel = (d: { field: string; label?: string }) => (d.label?.trim() ? d.label : labelOf(d.field));
  const metricLabel = (m: { field: string; label?: string }) => (m.label?.trim() ? m.label : labelOf(m.field));

  const meta: RenderSchema['cols'] = [
    ...rowDims.map((d, i) => ({
      idx: i, role: 'dimension' as const, axis: 'row' as const, label: dimLabel(d),
      width: 96, align: 'left' as const,
    })),
    ...metrics.map((m, i) => ({
      idx: rowDims.length + i, role: 'metric' as const, label: metricLabel(m),
      width: 120, align: 'right' as const, num_fmt: m.num_fmt_ref === 'money' ? '#,##0.00' : '#,##0', metric: m.field,
    })),
  ];
  const colDimMeta: RenderSchema['col_dims'] = colDims.map((d) => ({ field: d.field, label: dimLabel(d) }));
  const hasColDims = colDims.length > 0;

  // 分组仅按行维度组合键（保序）；列维度值由 detail 行原样携带，S2 负责透视列头
  const groupKey = (r: Record<string, unknown>) => rowDims.map((d) => String(r[d.field] ?? '')).join('\u0001');
  const groups = new Map<string, Array<Record<string, unknown>>>();
  const order: string[] = [];
  for (const r of parsed.rows) {
    const k = groupKey(r);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push(r);
  }
  const showKeys = order.slice(0, 8);

  // 分类收集每个指标（每行维度组合 / 全量）的数值，按 agg 汇总为小计/总计
  const rawMetric = (r: Record<string, unknown>, field: string): number | null => {
    const n = Number(r[field]);
    return Number.isNaN(n) ? null : n;
  };
  const groupValues = new Map<string, number[][]>();
  const totalValues = metrics.map(() => [] as number[]);
  for (const r of parsed.rows) {
    const k = rowDims.length ? groupKey(r) : '__all__';
    if (!groupValues.has(k)) groupValues.set(k, metrics.map(() => [] as number[]));
    const gvs = groupValues.get(k)!;
    metrics.forEach((m, i) => {
      const n = rawMetric(r, m.field);
      if (n !== null) { gvs[i].push(n); totalValues[i].push(n); }
    });
  }

  let idx = 1;
  const rows: RowDTO[] = [
    { idx: idx++, type: 'header', cells: meta.map((c) => ({ col: c.idx, cell_id: `r1c${c.idx}`, value: c.label, display: c.label, style: 's1' })) },
  ];

  // 条件格式的数据条以真实指标最大值为上界
  let rowCountForCF = 0;
  const cfMax = metrics.reduce((acc, m) => Math.max(acc,
    parsed.rows.reduce((a, r) => Math.max(a, rawMetric(r, m.field) ?? 0), 0)), 1);

  for (const k of showKeys) {
    const group = groups.get(k)!;
    const combo = k.split('\u0001');
    let seqInGroup = 0;
    for (const r of group.slice(0, 4)) {
      seqInGroup += 1;
      rowCountForCF += 1;
      const rIdx = idx++;
      const cells = meta.map((c) => {
        if (c.role === 'dimension') {
          const v = String(r[rowDims[c.idx].field] ?? '');
          return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: v, style: 's2' };
        }
        const v = rawMetric(r, c.metric ?? '') ?? 0;
        return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's2' };
      });
      const detail: RowDTO = { idx: rIdx, type: 'detail' as const, group_path: combo, seq: seqInGroup, cells };
      if (hasColDims) {
        detail.col_dim_values = {};
        for (const cd of colDims) detail.col_dim_values[cd.field] = String(r[cd.field] ?? '');
      }
      rows.push(detail);
    }
    // 小计：手动输出仅用于无列维度场景（列维度下由 S2 透视自动小计）
    if (!hasColDims) {
      const rIdx = idx++;
      rowCountForCF += 1;
      const gvs = groupValues.get(k) ?? [];
      const cells = meta.map((c) => {
        if (c.role === 'dimension') {
          const v = c.idx === rowDims.length - 1 ? String(combo[c.idx] ?? '') : '';
          return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: v, style: 's3' };
        }
        const vi = metrics.findIndex((m) => m.field === c.metric);
        const v = aggValue(metrics[vi]?.agg ?? 'SUM', gvs[vi] ?? []);
        return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's3' };
      });
      rows.push({ idx: rIdx, type: 'subtotal' as const, group_path: combo, cells });
    }
  }

  if (!hasColDims) {
    const rIdx = idx++;
    const totalCells = meta.map((c) => {
      if (c.role === 'dimension') {
        const v = c.idx === 0 ? '总计' : '';
        return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: v, style: 's3' };
      }
      const vi = metrics.findIndex((m) => m.field === c.metric);
      const v = aggValue(metrics[vi]?.agg ?? 'SUM', totalValues[vi] ?? []);
      return { col: c.idx, cell_id: `r${rIdx}c${c.idx}`, value: v, display: String(v), style: 's3' };
    });
    rows.push({ idx: rIdx, type: 'total' as const, cells: totalCells });
  }

  return {
    schema_version: 1,
    report: { id: payload.id ?? 'rpt_sales', def_version: payload.version ?? 2, row_total: rows.length },
    cols: meta,
    col_dims: hasColDims ? colDimMeta : undefined,
    styles: SCHEMA_STYLES,
    merges: [],
    rows,
    page_setup: { orientation: 'landscape', fit_to_width: 1, repeat_header_rows: 1 },
    conditional_formats: metrics[0]
      ? [{ id: 'cf_amount', kind: 'data_bar' as const, color: '#638EC6', ranges: [`C2:C${rowCountForCF + 1}`], stats: { min: 0, max: cfMax } }]
      : [],
  };
}

/**
 * 演示数据兜底已删除：平台任何报表预览只来自真实上传并解析的 CSV 行。
 * 数据管理页创建数据源/数据集时未提供真实文件内容将返回 400。
 */

// ---------------------------------------------------------------------------
// handlers — 全部挂在 '*/v1/...' 下
// 仅依赖 msw 的 http/HttpResponse，浏览器与 node 环境共用。
// ---------------------------------------------------------------------------

export const handlers = [
  http.get('*/v1/datasources', () =>
    HttpResponse.json(dbSources),
  ),

  http.post('*/v1/datasources', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { name?: string; file_name?: string; content?: string };
    const name = (body.name ?? '').trim() || '未命名数据源';
    const fileName = body.file_name ?? 'data.csv';
    const content = body.content ?? '';
    if (!content.trim()) return HttpResponse.json({ error: 'CSV 内容为空' }, { status: 400 });
    const parsed = parseCsvText(content);
    const source: DataSourceInfo = {
      id: `ds_${Date.now().toString(36)}`,
      name,
      kind: 'csv',
      detail: `csv_local · ${parsed.rows.length} 行 × ${parsed.columns.length} 列（${fileName}）`,
      tables: [fileName],
    };
    csvTables.set(source.id, new Map([[fileName, parsed]]));
    dbSources.push(source);
    return HttpResponse.json(source, { status: 201 });
  }),

  http.post('*/v1/datasources/:id/tables', async ({ request, params }) => {
    const source = dbSources.find((s) => s.id === params.id);
    if (!source) return HttpResponse.json({ error: 'datasource not found' }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { file_name?: string; content?: string };
    const fileName = body.file_name ?? 'data.csv';
    const content = body.content ?? '';
    if (!content.trim()) return HttpResponse.json({ error: 'CSV 内容为空' }, { status: 400 });
    const parsed = parseCsvText(content);
    const tables = csvTables.get(source.id) ?? new Map<string, ParsedTable>();
    tables.set(fileName, parsed);
    csvTables.set(source.id, tables);
    if (!source.tables?.includes(fileName)) source.tables = [...(source.tables ?? []), fileName];
    return HttpResponse.json({ ok: `table ${fileName} uploaded`, tables: source.tables });
  }),

  http.delete('*/v1/datasources/:id', ({ params }) => {
    const idx = dbSources.findIndex((s) => s.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'datasource not found' }, { status: 404 });
    const [removed] = dbSources.splice(idx, 1);
    csvTables.delete(removed.id);
    return HttpResponse.json({ ok: 'deleted' });
  }),

  http.get('*/v1/datasets', () =>
    HttpResponse.json(dbDatasets.map(({ id, name, source_ref, source_name, field_count, fields, updated_at, sample_rows }) => ({
      id, name, source_ref, source_name, field_count, fields, updated_at,
      row_count: sample_rows?.length ?? 0,
    }))),
  ),

  http.post('*/v1/datasets', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { name?: string; source_ref?: string; table?: string };
    const name = body.name?.trim() || '新数据集';
    const source = dbSources.find((s) => s.id === body.source_ref);
    if (!source) return HttpResponse.json({ error: '数据源不存在，请先创建数据源并上传 CSV' }, { status: 400 });
    const table = body.table ?? source.tables?.[0];
    const parsed = table ? tableOf(source.id, table) : undefined;
    // 数据集必须绑定真实上传并解析过的 CSV 表，不允许兜底到演示字段
    if (!parsed || parsed.rows.length === 0) {
      return HttpResponse.json({ error: `数据源「${source.name}」没有可用的真实表，请先上传 CSV 文件` }, { status: 400 });
    }
    const fields = parsed.fields;
    const sample_rows = parsed.rows.slice(0, 10);
    const dataset: DatasetInfo & { table?: string; sample_rows: Array<Record<string, unknown>> } = {
      id: `set_${Date.now().toString(36)}`,
      name,
      source_ref: source.id,
      source_name: source.name,
      field_count: fields.length,
      fields,
      table,
      updated_at: new Date().toISOString(),
      sample_rows,
    };
    dbDatasets.push(dataset);
    return HttpResponse.json(dataset, { status: 201 });
  }),

  http.delete('*/v1/datasets/:id', ({ params }) => {
    const idx = dbDatasets.findIndex((d) => d.id === params.id);
    if (idx < 0) return HttpResponse.json({ error: 'dataset not found' }, { status: 404 });
    dbDatasets.splice(idx, 1);
    return HttpResponse.json({ ok: 'deleted' });
  }),

  http.get('*/v1/datasets/:datasetId', ({ params }) => {
    const ds = dbDatasets.find((d) => d.id === params.datasetId);
    if (!ds) return HttpResponse.json({ error: 'dataset not found' }, { status: 404 });
    return HttpResponse.json(ds);
  }),

  http.get('*/v1/definitions/:id/draft', ({ params }) =>
    HttpResponse.json({
      version: 2,
      payload: JSON.stringify({ ...draftFor(String(params.id)), name: String(params.id) === 'rpt_sales' ? '销售报表' : '新建报表' }),
    }),
  ),

  http.get('*/v1/definitions/:id/published', ({ params }) =>
    HttpResponse.json({
      version: 2,
      payload: JSON.stringify({ ...draftFor(String(params.id)), name: String(params.id) === 'rpt_sales' ? '销售报表' : '新建报表' }),
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
    const body = await request.json().catch(() => ({})) as {
      def_id?: string;
      row_window?: { from: number; to: number };
      payload?: Partial<typeof defaultDraftPayload>;
    };
    // 预览渲染以编辑器当前草稿 payload 为准（前端即真相源），杜绝跨会话/跨导航缓存残留；
    // 未携带 payload 时回退到已保存草稿/默认配置（兼容测试与外部调用）。
    const payload = body.payload ?? draftCache.get(body.def_id ?? '') ?? draftFor(body.def_id ?? 'rpt_new');
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

  http.get('*/v1/export/:taskId/download', async ({ request }) => {
    // 导出下载：按最近保存的草稿配置动态生成真实 Excel（带表头样式/合并/数据条），不再返回 SPA 页面
    const defId = new URL(request.url).searchParams.get('def_id') ?? 'rpt_sales';
    const payload = draftCache.get(defId) ?? draftFor(defId);
    const schema = buildMockSchema(payload);
    const buf = await xlsxFromSchema(schema);
    const reportName = (payload.name ?? 'report').replace(/[\\/"]/g, '_').trim() || 'report';
    // Header 值必须 ASCII 合法：filename 用安全化名称，中文名经 filename*=UTF-8 传给现代浏览器
    const asciiName = reportName.replace(/[^\x20-\x7E]/g, '_');
    const disposition = `attachment; filename="${asciiName}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${reportName}.xlsx`)}`;
    return new HttpResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': disposition,
      },
    });
  }),
];

/**
 * schema → 真实 Excel 工作簿（.xlsx）字节流：
 * 表头/明细/小计/总计按 s1/s2/s3 样式映射（底色、加粗、边框、对齐、数字格式），
 * 维度列跨组合并，首指标列附加数据条条件格式。
 */
async function xlsxFromSchema(schema: RenderSchema): Promise<ArrayBuffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报表');

  const argb = (hex?: string) => (hex && hex.startsWith('#') ? hex.replace('#', 'FF') : undefined);
  const BORDER = { style: 'thin' as const, color: { argb: 'FF9AA7B0' } };
  const border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  for (const row of schema.rows) {
    const excelRow = ws.getRow(row.idx);
    for (const cell of row.cells) {
      const st = SCHEMA_STYLES[cell.style] ?? SCHEMA_STYLES.s2;
      const target = excelRow.getCell(cell.col + 1);
      target.value = typeof cell.value === 'number' ? cell.value : cell.display;
      target.font = { bold: st.Bold === true, color: { argb: argb(st.FontColor) ?? 'FF1F2937' } };
      target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.Fill) ?? 'FFFFFFFF' } };
      target.border = border;
      const meta = schema.cols.find((c) => c.idx === cell.col);
      if (meta) {
        target.alignment = { horizontal: meta.align === 'right' ? 'right' : 'left', vertical: 'middle' };
        if (meta.num_fmt && typeof cell.value === 'number') target.numFmt = meta.num_fmt;
      }
    }
  }

  schema.cols.forEach((c) => {
    // Excel 列宽单位为字符位宽，由渲染宽度换算
    ws.getColumn(c.idx + 1).width = Math.max(10, Math.round(c.width / 7));
  });

  // 维度列跨行合并（r1/r2/c 均为 1-based，对应 rows.idx 与 cols.idx）
  for (const m of schema.merges ?? []) {
    try { ws.mergeCells(m.r1, m.c, m.r2, m.c); } catch { /* 越界或冲突忽略 */ }
  }

  // 首指标列数据条
  const firstMetric = schema.cols.find((c) => c.role === 'metric');
  if (firstMetric) {
    const colLetter = String.fromCharCode(65 + firstMetric.idx);
    const last = Math.max(2, schema.rows.length);
    try {
      // exceljs 数据条最低需要 type + cfvo 数组
      ws.addConditionalFormatting({
        ref: `${colLetter}2:${colLetter}${last}`,
        rules: [{
          type: 'dataBar',
          priority: 1,
          gradient: true,
          cfvo: [{ type: 'min' }, { type: 'max' }],
        }],
      });
    } catch { /* exceljs 版本不支持 dataBar 时忽略，不影响文件生成 */ }
  }

  const raw = await wb.xlsx.writeBuffer();
  if (raw instanceof ArrayBuffer) return raw;
  const bytes = raw as Uint8Array;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
