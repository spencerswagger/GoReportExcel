import { DataCell, RowCell, ColCell } from '@antv/s2';
import type { ResolvedStyle } from '../api/types';
import type { SpreadSheet, ViewMeta, RowHeaderConfig, ColHeaderConfig, Node } from '@antv/s2';
import { Rect, Line } from '@antv/g';
import type { Group } from '@antv/g';
import type { PreviewModel } from './transform';

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
  // 行头节点 → 合并态：锚点 { anchor:true, anchorCellId }；覆盖行 { anchor:false, covered:true }；区间外 { anchor:false }
  // covered 用于区分"合并区间内非锚点"（隐藏文本）与"区间外"（照常展示）
  mergeOf(level: number, recordIndex: number): { anchor: boolean; anchorCellId?: string; covered?: boolean };
  // 列头字段 → 表头样式 cell_id（headerStyles）
  headerCellIdOf(field: string): string | undefined;
}

export function makeCellLookup(
  model: Pick<PreviewModel, 'styles' | 'dimMerges' | 'headerStyles'>,
): CellStyleLookup {
  const { styles, dimMerges, headerStyles } = model;
  return {
    styleOf: (id) => (id ? styles[id] : undefined),
    indentOf: (id) => styles[id]?.Indent ?? 0,
    mergeOf: (level, recordIndex) => {
      // dimMerges 数量小，线性查找即可；level 对应 dimFields 下标
      const m = dimMerges.find((d) => d.level === level && recordIndex >= d.from && recordIndex <= d.to);
      if (!m) return { anchor: false }; // 区间外：正常展示
      if (recordIndex === m.from) return { anchor: true, anchorCellId: m.anchorCellId }; // 锚点
      return { anchor: false, covered: true }; // 覆盖行：隐藏文本
    },
    headerCellIdOf: (field) => headerStyles[field],
  };
}

// 供渲染期使用：按 cell 元信息取 cell_id（PreviewSheet 经 layoutCellMeta 注入 __cellId）
export function cellIdOf(meta: { __cellId?: string }): string {
  return meta.__cellId ?? '';
}

// 样式查找表按 spreadsheet 实例挂载（WeakMap），避免模块级全局跨 Sheet/多实例/HMR 串稿。
// WeakMap 以实例为键，实例被回收后自动 GC，无泄漏、不污染实例属性。
const styleLookups = new WeakMap<object, CellStyleLookup>();

// 绑定到具体 spreadsheet 实例（PreviewSheet 在挂载时调用）
export function setCellStyleLookup(spreadsheet: object, lookup: CellStyleLookup): void {
  styleLookups.set(spreadsheet, lookup);
}

// 按实例取回样式查找表（未绑定返回 undefined）
export function getCellStyleLookup(spreadsheet: object): CellStyleLookup | undefined {
  return styleLookups.get(spreadsheet);
}

// 当前选中数据格（按 spreadsheet 实例隔离的 WeakMap，与 styleLookups 同模式）。
// WeakMap 以实例为键，实例被回收后自动 GC，无泄漏、不污染实例属性。
const selectedLookups = new WeakMap<object, string | null>();

export function setSelectedCell(spreadsheet: object, cellId: string | null): void {
  selectedLookups.set(spreadsheet, cellId);
}

// 按实例取回选中单元格（未绑定返回 undefined，与未选中 null 区分）
export function getSelectedCell(spreadsheet: object): string | null | undefined {
  return selectedLookups.get(spreadsheet);
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
    const style = cellId ? getCellStyleLookup(this.spreadsheet)?.styleOf(cellId) : undefined;
    drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);

    // 选中高亮：选中变化经 setSelectedCell 按实例传导，此处与当前格的 cell_id 匹配时
    // 叠加一圈金色外边描边（沿用旧画布选中语义），绘制在背景填充之后避免被盖住。
    if (cellId && getSelectedCell(this.spreadsheet) === cellId) {
      const { x, y, width, height } = this.getBBoxByType();
      this.appendChild(
        new Rect({
          style: {
            x, y, width, height,
            fill: 'transparent',
            stroke: '#C8923E',
            lineWidth: 2,
            lineDash: undefined,
          },
        }),
      );
    }
  }
}

// 行头单元格：支持 Indent 缩进，为合并区间锚点绘制预留接口
export class ReportRowCell extends RowCell {
  constructor(node: Node, spreadsheet: SpreadSheet, headerConfig: RowHeaderConfig) {
    super(node, spreadsheet, headerConfig);
  }

  protected drawBackgroundShape(): void {
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const style = cellId ? getCellStyleLookup(this.spreadsheet)?.styleOf(cellId) : undefined;
    drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);
  }

  // 文本缩进：RowCell 原生缩进 + Indent 查表（每个 indent 单位对应 10px）
  protected getContentIndent(): number {
    const baseIndent = super.getContentIndent();
    const cellId = cellIdOf(this.meta as unknown as { __cellId?: string });
    const customIndent = cellId ? (getCellStyleLookup(this.spreadsheet)?.indentOf(cellId) ?? 0) : 0;
    // 缩进单位 10px（与旧画布 StyleSheet 一致），未来缩放/字号调整时注意
    return baseIndent + customIndent * 10;
  }

  // 合并单元格：grid 模式维度列纵向合并，覆盖行（合并区间内非锚点）空白、锚点显示文本、区间外照常展示
  // rowIndex 取 Node 的 rowIndex（若为 undefined 退化显示文本）
  drawTextShape(): void {
    const node = this.meta as unknown as { level?: number; rowIndex?: number };
    if (node.level !== undefined && node.rowIndex !== undefined) {
      const merge = getCellStyleLookup(this.spreadsheet)?.mergeOf(node.level, node.rowIndex);
      if (merge?.covered) {
        return; // 覆盖行：背景/边框仍绘制，仅隐藏文本
      }
    }
    super.drawTextShape();
  }
}

// 列头单元格：读 headerStyles（已映射到 styleId）应用 ResolvedStyle
export class ReportColCell extends ColCell {
  constructor(node: Node, spreadsheet: SpreadSheet, headerConfig: ColHeaderConfig) {
    super(node, spreadsheet, headerConfig);
  }

  // 取当前列头格样式：列头为 Node 元信息（无 __cellId 注入），按 node.field 从 headerStyles 反查 styleId，
  // 再经 styleOf 得到 ResolvedStyle；找不到（如角头/未命中）返回 undefined 走基类默认主题。
  protected headerStyle(): ResolvedStyle | undefined {
    const lookup = getCellStyleLookup(this.spreadsheet);
    const node = this.meta as unknown as { field?: string };
    if (!lookup || node.field === undefined || node.field === '') return undefined;
    const styleId = lookup.headerCellIdOf(node.field);
    return styleId ? lookup.styleOf(styleId) : undefined;
  }

  protected drawBackgroundShape(): void {
    const style = this.headerStyle();
    if (style) {
      // 列头逐格样式：底色（fill）与四边线型边框复用 drawStyledBackground（与数据格/行头同款 Rect+Line 方案）
      drawStyledBackground(this, () => super.drawBackgroundShape(), () => this.getBBoxByType(), style);
      return;
    }
    super.drawBackgroundShape();
  }

  // 字重：继承 Bold 属性
  protected getTextStyle() {
    const baseStyle = super.getTextStyle();
    if (this.headerStyle()?.Bold) {
      return { ...baseStyle, fontWeight: 'bold' as const };
    }
    return baseStyle;
  }
}
