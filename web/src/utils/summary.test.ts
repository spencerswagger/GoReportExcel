import { describe, expect, it } from 'vitest';
import { summarizeCondition } from './summary';

describe('summarizeCondition', () => {
  it('leaf eq', () => {
    expect(summarizeCondition({ ctx: 'row_type', op: 'eq', value: 'subtotal' }))
      .toBe('行类型 = "subtotal"');
  });

  it('leaf mod+eq', () => {
    expect(summarizeCondition({ ctx: 'seq_in_group', op: 'eq', mod: 2, value: 0 }))
      .toBe('组内序号 mod 2 = 0');
  });

  it('all combinator joins with 且', () => {
    const s = summarizeCondition({
      all: [
        { ctx: 'row_type', op: 'eq', value: 'detail' },
        { ctx: 'col_role', op: 'eq', value: 'metric' },
      ],
    });
    expect(s).toBe('(行类型 = "detail" 且 列角色 = "metric")');
  });

  it('unknown ctx falls back to raw', () => {
    expect(summarizeCondition({ ctx: 'whatever', op: 'gt', value: 1 })).toContain('whatever');
  });
});
