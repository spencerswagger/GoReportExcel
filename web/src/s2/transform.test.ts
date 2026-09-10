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
});