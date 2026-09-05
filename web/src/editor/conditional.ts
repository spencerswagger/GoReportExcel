import type { CFInfo, RowDTO } from '../api/types';

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
  // 任一色非法时回退返回 from，避免产生 #NaNNaN69 垃圾输出
  if (!a || !b) return from;
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function topNHitIds(rows: CellLike[], n: number): string[] {
  // 负 n / 小数 n 归一化：slice(0, 负值) 会反向截取，先钳制为 0
  const k = Math.max(0, Math.floor(n));
  return [...rows].sort((a, b) => b.value - a.value).slice(0, k).map((r) => r.cellId);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1];
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
  background?: string;       // color_scale / top_n 填充色
}

// 解析 "C2:C11" / "C2" 范围：列字母 → 0-based 列号，行号 → 行区间；无法解析返回 null
function parseRange(range: string): { col: number; r1: number; r2: number } | null {
  const m = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(range.trim());
  if (!m) return null;
  const col = colLetterToIndex(m[1]);
  const r1 = parseInt(m[2], 10);
  if (m[3] && m[4]) {
    const r2 = parseInt(m[4], 10);
    return { col, r1, r2: Math.max(r1, r2) };
  }
  return { col, r1, r2: r1 };
}

function colLetterToIndex(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1; // 1-based → 0-based
}

export function applyConditional(rows: RowDTO[], cf: CFInfo, metricCol: number): CFVisual[] {
  // 范围列优先（如 C2:C11 的 C 列），缺失/无法解析时回退 metricCol
  const range = cf.ranges?.length ? parseRange(cf.ranges[0]) : null;
  const col = range?.col ?? metricCol;
  const rowFrom = range?.r1 ?? -Infinity;
  const rowTo = range?.r2 ?? Infinity;

  // 稀疏 cells 按 col 定位单元格
  const cellAt = (row: RowDTO) => row.cells.find((c) => c.col === col);

  if (cf.kind === 'top_n' && cf.n && cf.n > 0) {
    const cells: CellLike[] = [];
    for (const row of rows) {
      if (row.idx < rowFrom || row.idx > rowTo) continue;
      const c = cellAt(row);
      if (c && typeof c.value === 'number') {
        cells.push({ idx: row.idx, cellId: c.cell_id, value: c.value });
      }
    }
    const ids = new Set(topNHitIds(cells, cf.n));
    const background = cf.style?.fill?.color;
    return cells
      .filter((c) => ids.has(c.cellId))
      .map((c) => ({ cellId: c.cellId, kind: 'top_n' as const, ...(background ? { background } : {}) }));
  }
  if (cf.kind === 'data_bar' && cf.stats) {
    const out: CFVisual[] = [];
    for (const row of rows) {
      if (row.idx < rowFrom || row.idx > rowTo) continue;
      const c = cellAt(row);
      if (c && typeof c.value === 'number') {
        out.push({ cellId: c.cell_id, kind: 'data_bar', width: dataBarWidth(c.value, cf.stats) });
      }
    }
    return out;
  }
  if (cf.kind === 'color_scale' && cf.stats && cf.color) {
    const out: CFVisual[] = [];
    for (const row of rows) {
      if (row.idx < rowFrom || row.idx > rowTo) continue;
      const c = cellAt(row);
      if (c && typeof c.value === 'number') {
        out.push({
          cellId: c.cell_id, kind: 'color_scale',
          background: colorScaleColor(c.value, cf.stats, '#FFFFFF', cf.color),
        });
      }
    }
    return out;
  }
  return [];
}
