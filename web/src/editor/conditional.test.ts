import { describe, expect, it } from 'vitest';
import { dataBarWidth, topNHitIds, colorScaleColor, applyConditional } from './conditional';
import type { CFInfo, RowDTO } from '../api/types';

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

  it('topNHitIds normalizes negative n to empty', () => {
    const rows = [
      { idx: 2, cellId: 'r2c2', value: 100 },
      { idx: 3, cellId: 'r3c2', value: 300 },
    ];
    expect(topNHitIds(rows, -2)).toEqual([]);
  });

  it('colorScaleColor falls back to from color on invalid input', () => {
    expect(colorScaleColor(500, stats, 'red', '#638EC6')).toBe('red');
    expect(colorScaleColor(500, stats, '#FFFFFF', 'notacolor')).toBe('#FFFFFF');
  });
});

describe('applyConditional', () => {
  const stats = { min: 0, max: 1000 };
  // 稀疏 cells：仅含 metric 列（col 2），行号 1..5
  const rows: RowDTO[] = [
    { idx: 1, type: 'header', cells: [{ col: 2, cell_id: 'r1c2', value: '销售额', display: '销售额', style: 's1' }] },
    { idx: 2, type: 'detail', cells: [{ col: 2, cell_id: 'r2c2', value: 100, display: '100', style: 's2' }] },
    { idx: 3, type: 'detail', cells: [{ col: 2, cell_id: 'r3c2', value: 200, display: '200', style: 's2' }] },
    { idx: 4, type: 'detail', cells: [{ col: 2, cell_id: 'r4c2', value: 300, display: '300', style: 's2' }] },
    { idx: 5, type: 'detail', cells: [{ col: 2, cell_id: 'r5c2', value: 400, display: '400', style: 's2' }] },
  ];

  it('data_bar applies only to rows in ranges subset with scaled width', () => {
    const cf: CFInfo = { id: 'cf', kind: 'data_bar', ranges: ['C2:C3'], stats };
    const out = applyConditional(rows, cf, 2);
    expect(out).toEqual([
      { cellId: 'r2c2', kind: 'data_bar', width: 0.1 },
      { cellId: 'r3c2', kind: 'data_bar', width: 0.2 },
    ]);
  });

  it('data_bar falls back to whole column when ranges missing', () => {
    const cf: CFInfo = { id: 'cf', kind: 'data_bar', ranges: [], stats };
    const out = applyConditional(rows, cf, 2);
    // 行 1 值为字符串被跳过，行 2..5 共 4 个命中
    expect(out).toHaveLength(4);
    expect(out.map((v) => v.cellId)).toEqual(['r2c2', 'r3c2', 'r4c2', 'r5c2']);
  });

  it('color_scale returns interpolated background per hit', () => {
    const scaleRows: RowDTO[] = [
      { idx: 2, type: 'detail', cells: [{ col: 2, cell_id: 'r2c2', value: 0, display: '0', style: 's2' }] },
      { idx: 3, type: 'detail', cells: [{ col: 2, cell_id: 'r3c2', value: 1000, display: '1000', style: 's2' }] },
    ];
    const cf: CFInfo = { id: 'cf', kind: 'color_scale', ranges: ['C2:C3'], stats, color: '#638EC6' };
    const out = applyConditional(scaleRows, cf, 2);
    expect(out).toHaveLength(2);
    expect(out[0].background).toBe('#ffffff');
    expect(out[1].background).toBe('#638ec6');
  });

  it('top_n returns hits with fill background and ignores negative n', () => {
    const cf: CFInfo = { id: 'cf', kind: 'top_n', n: 2, ranges: ['C2:C5'], style: { fill: { color: '#FFC000' } } };
    const out = applyConditional(rows, cf, 2);
    // 命中按行号升序返回（画布渲染顺序），top 2 为 r5c2(400) 与 r4c2(300)
    expect(out).toEqual([
      { cellId: 'r4c2', kind: 'top_n', background: '#FFC000' },
      { cellId: 'r5c2', kind: 'top_n', background: '#FFC000' },
    ]);
    const neg: CFInfo = { id: 'cf', kind: 'top_n', n: -2, ranges: ['C2:C5'], style: { fill: { color: '#FFC000' } } };
    expect(applyConditional(rows, neg, 2)).toEqual([]);
  });
});
