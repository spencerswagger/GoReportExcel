import type { CFInfo, CellDTO } from '../api/types';

export interface CellLike {
  idx: number;      // 物理行号
  cellId: string;
  value: number;
}

export function dataBarWidth(v: number, stats: { min: number; max: number }): number {
  const span = stats.max - stats.min;
  if (span <= 0) return 1;
  const ratio = (v - stats.min) / span;
  return Math.max(0, Math.min(1, ratio));
}

export function colorScaleColor(v: number, stats: { min: number; max: number }, from: string, to: string): string {
  const t = dataBarWidth(v, stats);
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function topNHitIds(rows: CellLike[], n: number): string[] {
  return [...rows].sort((a, b) => b.value - a.value).slice(0, n).map((r) => r.cellId);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// 把后端 CFInfo 展开为画布可见的"命中样式注记"（供画布附加内联样式/类）。
export interface CFVisual {
  cellId: string;            // 命中单元格（锚点）
  kind: CFInfo['kind'];
  width?: number;            // data_bar
  background?: string;       // color_scale
}

export function applyConditional(rows: CellDTO[][], cf: CFInfo, metricCol: number): CFVisual[] {
  if (cf.kind === 'top_n' && cf.n) {
    const cells: CellLike[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i][metricCol];
      if (c && typeof c.value === 'number') {
        cells.push({ idx: i, cellId: c.cell_id, value: c.value as number });
      }
    }
    const ids = new Set(topNHitIds(cells, cf.n));
    return cells.filter((c) => ids.has(c.cellId)).map((c) => ({ cellId: c.cellId, kind: 'top_n' as const }));
  }
  if (cf.kind === 'data_bar' && cf.stats) {
    const out: CFVisual[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i][metricCol];
      if (c && typeof c.value === 'number') {
        out.push({ cellId: c.cell_id, kind: 'data_bar', width: dataBarWidth(c.value as number, cf.stats) });
      }
    }
    return out;
  }
  if (cf.kind === 'color_scale' && cf.stats && cf.color) {
    const out: CFVisual[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i][metricCol];
      if (c && typeof c.value === 'number') {
        out.push({
          cellId: c.cell_id, kind: 'color_scale',
          background: colorScaleColor(c.value as number, cf.stats, '#FFFFFF', cf.color),
        });
      }
    }
    return out;
  }
  return [];
}
