import { useEffect, useMemo, useRef } from 'react';
import type { ColInfo, RenderSchema, RowDTO } from '../api/types';
import { styleSheetCSS } from './StyleSheet';

// 选中单元格的可见高亮样式（组件内静态追加，不依赖后端样式字典）
const SELECTED_CSS = '.cell-selected{outline:2px solid #1677ff;outline-offset:-2px}';

interface Props {
  schema: RenderSchema;
  selectedCell?: string | null;
  onSelect?: (cellId: string) => void;
}

export default function PreviewCanvas({ schema, selectedCell, onSelect }: Props) {
  const css = useMemo(() => styleSheetCSS(schema.styles), [schema.styles]);
  const ncols = schema.cols.length;
  const styleRef = useRef<HTMLStyleElement>(null);

  // 用 textContent 写入 CSS，避免 dangerouslySetInnerHTML 解析 HTML 造成 XSS
  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = css + SELECTED_CSS;
  }, [css]);

  return (
    <div className="preview-canvas" style={{ overflow: 'auto', height: '100%' }}>
      <style ref={styleRef} />
      <table style={{ borderCollapse: 'collapse', width: 'max-content' }}>
        <colgroup>
          {schema.cols.map((c) => <col key={c.idx} style={{ width: c.width * 7 }} />)}
        </colgroup>
        <tbody>
          {schema.rows.map((row) => (
            <RowView key={row.idx} row={row} ncols={ncols} cols={schema.cols} merges={schema.merges}
              selectedCell={selectedCell} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MergeResult {
  anchor: boolean;
  r1: number;
  r2: number;
}

function mergeOf(merges: RenderSchema['merges'], col: number, rowIdx: number): MergeResult {
  for (const m of merges) {
    if (m.c === col + 1 && rowIdx >= m.r1 && rowIdx <= m.r2) {
      return { anchor: rowIdx === m.r1, r1: m.r1, r2: m.r2 };
    }
  }
  return { anchor: true, r1: rowIdx, r2: rowIdx };
}

function RowView({ row, ncols, cols, merges, selectedCell, onSelect }: {
  row: RowDTO; ncols: number; cols: ColInfo[]; merges: RenderSchema['merges']; selectedCell?: string | null; onSelect?: (c: string) => void;
}) {
  // 先建 col → cell 索引，避免每列线性 find
  const cellByCol = new Map(row.cells.map((c) => [c.col, c]));
  return (
    <tr style={{ height: row.height || 24 }}>
      {Array.from({ length: ncols }, (_, col) => {
        const cell = cellByCol.get(col);
        if (!cell) return null;
        const m = mergeOf(merges, col, row.idx);
        // 合并区间内的非锚点行：由锚点 cell 的 rowSpan 覆盖，跳过渲染避免重复单元格
        if (!m.anchor) return null;
        return (
          <MergeCell key={col} cell={cell} cols={cols} selected={selectedCell === cell.cell_id}
            onSelect={onSelect} rowSpan={m.r2 > m.r1 ? m.r2 - m.r1 + 1 : undefined} />
        );
      })}
    </tr>
  );
}

function MergeCell({ cell, cols, selected, onSelect, rowSpan }: {
  cell: RowDTO['cells'][number]; cols: ColInfo[]; selected: boolean; onSelect?: (c: string) => void; rowSpan?: number;
}) {
  // 对齐方式取自 schema.cols 的 align 配置，不再硬编码列号
  const textAlign = cols[cell.col]?.align === 'right' ? 'right' : 'left';
  return (
    <td
      rowSpan={rowSpan}
      data-cell={cell.cell_id}
      className={`st-${cell.style}${selected ? ' cell-selected' : ''}`}
      style={{
        padding: '2px 8px', textAlign,
        whiteSpace: 'nowrap', cursor: 'pointer',
      }}
      title={cell.formula || cell.display}
      onClick={() => onSelect?.(cell.cell_id)}
    >
      {cell.formula || cell.display}
    </td>
  );
}
