import { describe, expect, it } from 'vitest';
import { borderStrokes, strokeFor, makeCellLookup } from './customCells';
import type { ResolvedStyle } from '../api/types';
import type { DimMerge } from './transform';

const base: ResolvedStyle = {
  BorderTop: 'thin', BorderRight: 'hair', BorderBottom: 'medium', BorderLeft: 'hair',
  Fill: '#fff', FontColor: '#000', Bold: false, RowHeight: 20, Indent: 0,
};

describe('borderStrokes / strokeFor', () => {
  it('hair/thin/medium 映射线宽', () => {
    const s = borderStrokes(base);
    expect(s.top?.width).toBe(1);
    expect(s.right?.width).toBe(0.5);
    expect(s.bottom?.width).toBe(2);
  });

  it('double 双线 / dashed 虚线 dash', () => {
    expect(strokeFor('double')?.width).toBe(3);
    expect(strokeFor('dashed')?.dash).toEqual([4, 3]);
    expect(strokeFor('solid-unknown')).toBeNull();
    expect(strokeFor(undefined)).toBeNull();
  });
});

describe('makeCellLookup', () => {
  // 维度列纵向合并 fixture：region level0 from0 to5 锚点 r2c0；city level1 from0 to2 锚点 r2c1
  const dimMerges: DimMerge[] = [
    { level: 0, from: 0, to: 5, anchorCellId: 'r2c0' },
    { level: 1, from: 0, to: 2, anchorCellId: 'r2c1' },
  ];
  const lookup = makeCellLookup({ styles: {}, dimMerges, headerStyles: { amount: 's1' } });

  it('mergeOf：锚点 / 覆盖行 / 区间外三态', () => {
    // 锚点：显示文本并携带 anchorCellId
    expect(lookup.mergeOf(0, 0)).toEqual({ anchor: true, anchorCellId: 'r2c0' });
    expect(lookup.mergeOf(1, 0)).toEqual({ anchor: true, anchorCellId: 'r2c1' });
    // 覆盖行（区间内非锚点）：隐藏文本
    expect(lookup.mergeOf(0, 3)).toEqual({ anchor: false, covered: true });
    expect(lookup.mergeOf(1, 2)).toEqual({ anchor: false, covered: true });
    // 区间外：正常展示（anchor false 但不标记 covered）
    expect(lookup.mergeOf(0, 7)).toEqual({ anchor: false });
    expect(lookup.mergeOf(1, 5)).toEqual({ anchor: false });
    // 区间端点含 from/to
    expect(lookup.mergeOf(0, 5)).toEqual({ anchor: false, covered: true });
  });

  it('headerCellIdOf：命中返回 styleId，未知字段 undefined', () => {
    expect(lookup.headerCellIdOf('amount')).toBe('s1');
    expect(lookup.headerCellIdOf('unknown')).toBeUndefined();
  });
});
