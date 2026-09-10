import { DataCell, RowCell, ColCell } from '@antv/s2';
import type { ResolvedStyle } from '../api/types';
import type { SpreadSheet, ViewMeta, RowHeaderConfig, ColHeaderConfig, Node } from '@antv/s2';
import { Rect, Line } from '@antv/g';
import type { Group } from '@antv/g';

// 线型 → 笔画（与旧 StyleSheet 线型语义一致）
export interface LineSpec { color: string; width: number; dash?: number[] }

export const LINE_SPEC: Record<string, LineSpec> = {
  hair: { color: '#D9D9D9', width: 0.5 },
  thin: { color: '#BFBFBF', width: 1 },
  medium: { color: '#404040', width: 2 },
  thick: { color: '#000000', width: 3 },
  double: { color: '#000000', width: 3 },
  dashed: { color: '#8C8C8C', width: 1, dash: [4, 3] },
};

export function strokeFor(line?: string): LineSpec | null {
  if (!line) return null;
  return LINE_SPEC[line] ?? null;
}

export function borderStrokes(st: ResolvedStyle) {
  return {
    left: strokeFor(st.BorderLeft),
    top: strokeFor(st.BorderTop),
    right: strokeFor(st.BorderRight),
    bottom: strokeFor(st.BorderBottom),
  };
}

export interface CellStyleLookup {
  styleOf(cellId: string): ResolvedStyle | undefined;
  indentOf(cellId: string): number;
}

export function makeCellLookup(model: { styles: Record<string, ResolvedStyle> }): CellStyleLookup {
  const { styles } = model;
  return {
    styleOf: (id) => (id ? styles[id] : undefined),
    indentOf: (id) => styles[id]?.Indent ?? 0,
  };
}

// 供渲染期使用：按 cell 元信息取 cell_id（PreviewSheet 经 layoutCellMeta 注入 __cellId）
export function cellIdOf(meta: { __cellId?: string }): string {
  return meta.__cellId ?? '';
}

// 全局样式表查找闭包，由 PreviewSheet 注入
let globalStyleLookup: CellStyleLookup | null = null;

export function setCellStyleLookup(lookup: CellStyleLookup): void {
  globalStyleLookup = lookup;
}

export function getCellStyleLookup(): CellStyleLookup | null {
  return globalStyleLookup;
}

// 在当前 Group 上绘制逐格背景填充 + 四边线型边框（来自 ResolvedStyle）
// fallback 无样式时回调（各基类的默认背景绘制）
function drawStyledBackground(
  group: Group,
  fallback: () => void,
  getBBox: () => { x: number; y: number; width: number; height: number },
  style: ResolvedStyle | undefined,
): void {
  if (style?.Fill) {
    const { x, y, width, height } = getBBox();
    group.appendChild(
      new Rect({ style: { x, y, width, height, fill: style.Fill, fillOpacity: 1, stroke: 'none' } }),
    );
  } else {
    fallback();
  }

  if (!style) return;
  const strokes = borderStrokes(style);
  const { x, y, width, height } = getBBox();
  // 线性边框：按 ResolvedStyle 的线型画四边
  const toLine = (vertical: boolean, axis: number, spec: { color: string; width: number; dash?: number[] }) => {
    const style = vertical
      ? { x1: axis, y1: y, x2: axis, y2: y + height }
      : { x1: x, y1: axis, x2: x + width, y2: axis };
    group.appendChild(
      new Line({
        style: {
          ...style,
          stroke: spec.color,
          lineWidth: spec.width,
          lineDash: spec.dash,
        },
      }),
    );
  };
  if (strokes.left) toLine(true, x, strokes.left);
  if (strokes.top) toLine(false, y, strokes.top);
  if (strokes.right) toLine(true, x + width, strokes.right);
  if (strokes.bottom) toLine(false, y + height, strokes.bottom);
}

// 数据单元格：逐格应用 ResolvedStyle 背景色和边框
export class ReportDataCell extends DataCell {
  constructor(viewMeta: ViewMeta, spreadsheet: SpreadSheet) {
    super(viewMeta, spreadsheet);
  }

  protected drawBackgroundShape(): void {
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const style = cellId ? globalStyleLookup?.styleOf(cellId) : undefined;
    drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);
  }
}

// 行头单元格：支持 Indent 缩进，为合并区间锚点绘制预留接口
export class ReportRowCell extends RowCell {
  constructor(node: Node, spreadsheet: SpreadSheet, headerConfig: RowHeaderConfig) {
    super(node, spreadsheet, headerConfig);
  }

  protected drawBackgroundShape(): void {
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const style = cellId ? globalStyleLookup?.styleOf(cellId) : undefined;
    drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);
  }

  // 文本缩进：RowCell 原生缩进 + Indent 查表（每个 indent 单位对应 10px）
  protected getContentIndent(): number {
    const baseIndent = super.getContentIndent();
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const customIndent = cellId ? (globalStyleLookup?.indentOf(cellId) ?? 0) : 0;
    return baseIndent + customIndent * 10;
  }

  // 合并单元格：__isMergeAnchor 为 true 才绘制文本，否则跳过（T8 由 PreviewSheet 注入该属性）
  drawTextShape(): void {
    const metaAny = this.meta as unknown as { __isMergeAnchor?: boolean };
    if (metaAny.__isMergeAnchor !== undefined && !metaAny.__isMergeAnchor) {
      return;
    }
    super.drawTextShape();
  }
}

// 列头单元格：读 headerStyles（已映射到 styleId）应用 ResolvedStyle
export class ReportColCell extends ColCell {
  constructor(node: Node, spreadsheet: SpreadSheet, headerConfig: ColHeaderConfig) {
    super(node, spreadsheet, headerConfig);
  }

  protected drawBackgroundShape(): void {
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const style = cellId ? globalStyleLookup?.styleOf(cellId) : undefined;
    drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);
  }

  // 字重：继承 Bold 属性
  protected getTextStyle() {
    const baseStyle = super.getTextStyle();
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const style = cellId ? globalStyleLookup?.styleOf(cellId) : undefined;
    if (style?.Bold) {
      return { ...baseStyle, fontWeight: 'bold' as const };
    }
    return baseStyle;
  }

  // 合并单元格：__isMergeAnchor 为 true 才绘制文本，否则跳过（T8 由 PreviewSheet 注入该属性）
  drawTextShape(): void {
    const metaAny = this.meta as unknown as { __isMergeAnchor?: boolean };
    if (metaAny.__isMergeAnchor !== undefined && !metaAny.__isMergeAnchor) {
      return;
    }
    super.drawTextShape();
  }
}