import { describe, expect, it } from 'vitest';
import { dataBarWidth, topNHitIds, colorScaleColor } from './conditional';

describe('conditional format simulation', () => {
  const stats = { min: 0, max: 1000 };

  it('data bar width scales value in [min,max]', () => {
    expect(dataBarWidth(0, stats)).toBe(0);
    expect(dataBarWidth(500, stats)).toBeCloseTo(0.5, 5);
    expect(dataBarWidth(1200, stats)).toBe(1); // 超上限钳制
  });

  it('color scale interpolates between two colors', () => {
    const lo = colorScaleColor(0, stats, '#FFFFFF', '#638EC6');
    const hi = colorScaleColor(1000, stats, '#FFFFFF', '#638EC6');
    const mid = colorScaleColor(500, stats, '#FFFFFF', '#638EC6');
    expect(lo).toBe('#ffffff');
    expect(hi).toBe('#638ec6');
    expect(mid).not.toBe(lo);
    expect(mid).not.toBe(hi);
  });

  it('top N collects first N row ids by desc value', () => {
    const rows = [
      { idx: 2, cellId: 'r2c2', value: 100 },
      { idx: 3, cellId: 'r3c2', value: 300 },
      { idx: 4, cellId: 'r4c2', value: 50 },
    ];
    const hits = topNHitIds(rows, 2);
    expect(hits).toEqual(['r3c2', 'r2c2']);
  });
});
