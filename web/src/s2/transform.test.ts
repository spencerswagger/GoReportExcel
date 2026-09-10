import { describe, expect, it } from 'vitest';
import { fixtureSchema } from '../api/mock';
import { buildPreview } from './transform';

describe('buildPreview data model', () => {
  const m = buildPreview(fixtureSchema, 'grid');

  it('fields: rows=维度, values=指标, columns 空', () => {
    expect(m.dataCfg.fields.rows).toEqual(['dim_0', 'dim_1']);
    expect(m.dataCfg.fields.values).toEqual(['amount', 'qty']);
    expect(m.dataCfg.fields.columns).toEqual([]);
  });

  it('records 全量（去掉 header 行）', () => {
    // fixture: header + 6 detail + 3 subtotal + 1 total = 11 行 → 10 records
    expect(m.records.length).toBe(10);
    const first = m.records[0];
    expect(first.dim_0).toBe('华东');
    expect(first.dim_1).toBe('上海');
    expect(first.amount).toBe(100);
    expect(first.__row).toEqual({ idx: 2, type: 'detail' });
    expect(first.__cellIds.amount).toBe('r2c2');
    expect(first.__cellIds.qty).toBe('r2c3');
    expect(first.__dimCellIds.dim_0).toBe('r2c0');
    expect(first.__dimCellIds.dim_1).toBe('r2c1');
    expect(first.__display.amount).toBe('100.00');
  });

  it('meta: 名称取 label，指标含 formatter 返回 display', () => {
    const amountMeta = m.dataCfg.meta?.find((x) => x.field === 'amount');
    expect(amountMeta?.name).toBe('销售额');
    const fmt = amountMeta?.formatter as (v: unknown, d?: Record<string, unknown>) => string;
    expect(fmt?.(100, m.records[0])).toBe('100.00');
  });

  it('subtotal 记录省略空维度键（data-provided totals）', () => {
    const m = buildPreview(fixtureSchema, 'grid');
    // records 顺序：上海/杭州/南京 subtotal 为 record2/5/8，total 为 record9
    const sh = m.records[2];
    expect(sh.__row.type).toBe('subtotal');
    expect(sh.amount).toBe(300);
    expect(sh.__cellIds.amount).toBe('r4c2');
    expect('dim_0' in sh).toBe(false); // 空维度键省略（上海小计行的 region 单元格 value ''）
    expect(sh.dim_1).toBe('上海');      // 非空维度值保留
  });

  it('total 记录无条件省略全部维度键（即使首列有"总计"文本）', () => {
    const m = buildPreview(fixtureSchema, 'grid');
    const total = m.records[9];
    expect(total.__row.type).toBe('total');
    expect(total.amount).toBe(1000);
    expect('dim_0' in total).toBe(false);
    expect('dim_1' in total).toBe(false);
    expect(total.__cellIds.amount).toBe('r11c2');
  });

  it('dim merges: 按物理行列映射到 record 索引区间', () => {
    const m2 = buildPreview(fixtureSchema, 'grid');
    const cityMerge = m2.dimMerges.find((x) => x.level === 1);
    expect(cityMerge).toEqual({ level: 1, from: 0, to: 2, anchorCellId: 'r2c1' });
    const regionMerge = m2.dimMerges.find((x) => x.level === 0);
    expect(regionMerge).toEqual({ level: 0, from: 0, to: 5, anchorCellId: 'r2c0' });
  });

  it('header styles: 表头字段 → styleId 映射', () => {
    const m2 = buildPreview(fixtureSchema, 'grid');
    expect(m2.headerStyles.dim_0).toBe('s1');
    expect(m2.headerStyles.amount).toBe('s1');
  });

  it('conditions.text: 指标列右对齐', () => {
    const m2 = buildPreview(fixtureSchema, 'grid');
    const text = m2.options.conditions?.text ?? [];
    expect(text.length).toBe(2);
    const amount = text.find((c) => (c as { field: unknown }).field === 'amount');
    expect(amount).toBeTruthy();
  });

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

  it('detail 行维度值为空也照常写入维度键（保持 detail 语义）', () => {
    const schema = structuredClone(fixtureSchema);
    // 把第 2 行（物理 idx 2，上海 detail，record 0）的大区维度值置空
    const row = schema.rows.find((r) => r.idx === 2)!;
    row.cells = row.cells.map((c) => (c.col === 0 ? { ...c, value: '', display: '' } : c));
    const m = buildPreview(schema, 'grid');
    const rec = m.records[0];
    expect('dim_0' in rec).toBe(true);
    expect(rec.dim_0).toBe('');
  });
});
