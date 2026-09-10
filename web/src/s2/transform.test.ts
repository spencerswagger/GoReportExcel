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
    // records: idx2=上海detail(record0)... recordings: subtotal 上海=record2(idx4), 杭州=record5(idx7), 南京=record8(idx10), total=record9(idx11)
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
});