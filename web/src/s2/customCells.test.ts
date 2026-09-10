import { describe, expect, it } from 'vitest';
import { borderStrokes, strokeFor } from './customCells';
import type { ResolvedStyle } from '../api/types';

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
