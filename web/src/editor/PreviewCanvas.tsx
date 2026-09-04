import { useMemo } from 'react';
import type { RenderSchema, RowDTO } from '../api/types';
import { styleSheetCSS } from './StyleSheet';

interface Props {
  schema: RenderSchema;
  selectedCell?: string | null;
  onSelect?: (cellId: string) => void;
}

export default function PreviewCanvas({ schema, selectedCell, onSelect }: Props) {
  const css = useMemo(() => styleSheetCSS(schema.styles), [schema.styles]);
  const ncols = schema.cols.length;

  return (
    <div className="preview-canvas" style={{ overflow: 'auto', height: '100%' }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <table style={{ borderCollapse: 'collapse', width: 'max-content' }}>
        <colgroup>
          {schema.cols.map((c) => <col key={c.idx} style={{ width: c.width * 7 }} />)}
        </colgroup>
        <tbody>
          {schema.rows.map((row) => (
            <RowView key={row.idx} row={row} ncols={ncols} merges={schema.merges}
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

function RowView({ row, ncols, merges, selectedCell, onSelect }: {
  row: RowDTO; ncols: number; merges: RenderSchema['merges']; selectedCell?: string | null; onSelect?: (c: string) => void;
}) {
  return (
    <tr style={{ height: row.height || 24 }}>
      {Array.from({ length: ncols }, (_, col) => {
        const cell = row.cells.find((c) => c.col === col);
        if (!cell) return null;
        const m = mergeOf(merges, col, row.idx);
        // 合并区间内的非锚点行：由锚点 cell 的 rowSpan 覆盖，跳过渲染避免重复单元格
        if (!m.anchor) return null;
        return (
          <MergeCell key={col} cell={cell} selected={selectedCell === cell.cell_id}
            onSelect={onSelect} rowSpan={m.r2 > m.r1 ? m.r2 - m.r1 + 1 : undefined} />
        );
      })}
    </tr>
  );
}

function MergeCell({ cell, selected, onSelect, rowSpan }: {
  cell: RowDTO['cells'][number]; selected: boolean; onSelect?: (c: string) => void; rowSpan?: number;
}) {
  return (
    <td
      rowSpan={rowSpan}
      data-cell={cell.cell_id}
      className={`st-${cell.style}${selected ? ' cell-selected' : ''}`}
      style={{
        border: '1px solid #e0e0e0', padding: '2px 8px', textAlign: cell.col < 2 ? 'left' : 'right',
        whiteSpace: 'nowrap', cursor: 'pointer',
      }}
      title={cell.formula || cell.display}
      onClick={() => onSelect?.(cell.cell_id)}
    >
      {cell.formula || cell.display}
    </td>
  );
}
