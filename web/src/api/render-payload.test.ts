import { test, expect } from 'vitest';
import { buildPreview } from '../s2/transform';

// 回归：预览渲染必须始终以编辑器当前草稿 payload 为准（前端真相源），
// 聚合切换、轴切换即时生效，且不读后端缓存（GET draft 空白时预览也空白）。
async function renderWith(draft: Record<string, unknown>) {
  const res = await fetch('/v1/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ def_id: 'rpt_new', row_window: { from: 0, to: 50 }, payload: draft }),
  });
  expect(res.ok).toBe(true);
  const { schema } = await res.json();
  return { schema, model: buildPreview(schema, 'grid') };
}

const baseDraft = {
  id: 'rpt_new', version: 2, name: '新建报表',
  dataset: { id: 'ds_sales', source_ref: 'csv_local', fields: [] },
};

test('payload 驱动：空白草稿渲染空画布（不读已保存缓存）', async () => {
  const { schema } = await renderWith({ ...baseDraft });
  expect(schema.cols).toHaveLength(0); // 未配置数据集/维度/指标 → 空预览
});

test('聚合方式生效：AVG 的小计/总计为平均值，非 SUM', async () => {
  const { schema: avgs } = await renderWith({
    ...baseDraft,
    dimensions: [{ field: 'region', label: '大区', axis: 'row', sort: { by: 'sort_key', dir: 'asc' } }],
    metrics: [{ field: 'amount', label: '销售额', agg: 'AVG', num_fmt_ref: 'money' }],
  });
  const total = avgs.rows.find((r: { type: string }) => r.type === 'total')!.cells.find((c: { col: number }) => c.col === 1)!.value as number;
  // 全量 30 行金额平均 = 178970 / 30
  expect(total).toBeCloseTo(5965.67, 2);

  const { schema: sums } = await renderWith({
    ...baseDraft,
    dimensions: [{ field: 'region', label: '大区', axis: 'row', sort: { by: 'sort_key', dir: 'asc' } }],
    metrics: [{ field: 'amount', label: '销售额', agg: 'SUM', num_fmt_ref: 'money' }],
  });
  const sumTotal = sums.rows.find((r: { type: string }) => r.type === 'total')!.cells.find((c: { col: number }) => c.col === 1)!.value as number;
  expect(sumTotal).toBe(178970);
});

test('列维度：全部维度为列时透视为 pivot，records 同时携带列维度值与指标值', async () => {
  const { model, schema } = await renderWith({
    ...baseDraft,
    dimensions: [{ field: 'channel', label: '渠道', axis: 'col', sort: { by: 'sort_key', dir: 'asc' } }],
    metrics: [{ field: 'amount', label: '销售额', agg: 'SUM', num_fmt_ref: 'money' }],
  });
  expect(model.sheetType).toBe('pivot');
  expect((model.dataCfg.fields as { columns: string[] }).columns).toContain('channel');
  expect(schema.col_dims).toEqual([{ field: 'channel', label: '渠道' }]);
  for (const rec of model.records) {
    if (rec.__row.type !== 'detail') continue;
    expect(rec.channel).not.toBeUndefined();
    expect(rec.amount).not.toBeUndefined();
  }
});