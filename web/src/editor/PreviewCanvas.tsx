import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement>(null);
  const rowHeight = 24;
  const virtualizer = useVirtualizer({
    count: schema.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();

  // 用 textContent 写入 CSS，避免 dangerouslySetInnerHTML 解析 HTML 造成 XSS
  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = css + SELECTED_CSS;
  }, [css]);

  return (
    <div ref={scrollRef} className="preview-canvas" style={{ overflow: 'auto', height: '100%' }}>
      <style ref={styleRef} />
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((vi) => {
          const row = schema.rows[vi.index];
          return (
            <div key={row.idx} data-row={row.idx}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${vi.start}px)`, height: rowHeight, display: 'flex',
              }}>
              {schema.cols.map((col) => {
                const cell = row.cells.find((c) => c.col === col.idx);
                if (!cell) return null;
                const m = mergeOf(schema.merges, col.idx, row.idx);
                // 合并区间内的非锚点行：由锚点 cell 覆盖，跳过渲染避免重复文本
                if (!m.anchor) return null;
                return (
                  <CellBox key={col.idx} cell={cell} cols={schema.cols}
                    selected={selectedCell === cell.cell_id} onSelect={onSelect}
                    mergeFrom={m.r2 > m.r1 ? m.r1 : undefined}
                    mergeTo={m.r2 > m.r1 ? m.r2 : undefined} />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MergeResult {
  anchor: boolean;
  r1: number;
  r2: number;
}

// 复用 T5 的合并判定：m.c 为 1-based 列号，col 为 0-based 列索引
function mergeOf(merges: RenderSchema['merges'], col: number, rowIdx: number): MergeResult {
  for (const m of merges) {
    if (m.c === col + 1 && rowIdx >= m.r1 && rowIdx <= m.r2) {
      return { anchor: rowIdx === m.r1, r1: m.r1, r2: m.r2 };
    }
  }
  return { anchor: true, r1: rowIdx, r2: rowIdx };
}

function CellBox({ cell, cols, selected, onSelect, mergeFrom, mergeTo }: {
  cell: RowDTO['cells'][number]; cols: ColInfo[]; selected: boolean;
  onSelect?: (c: string) => void; mergeFrom?: number; mergeTo?: number;
}) {
  // 对齐方式取自 schema.cols 的 align 配置，不再硬编码列号
  const textAlign = cols[cell.col]?.align === 'right' ? 'right' : 'left';
  const width = (cols[cell.col]?.width ?? 0) * 7;
  return (
    <div
      data-cell={cell.cell_id}
      data-merge-from={mergeFrom}
      data-merge-to={mergeTo}
      className={`st-${cell.style}${selected ? ' cell-selected' : ''}`}
      style={{
        width, minWidth: width, textAlign,
        padding: '2px 8px', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', cursor: 'pointer', boxSizing: 'border-box', flexShrink: 0,
      }}
      title={cell.formula || cell.display}
      onClick={() => onSelect?.(cell.cell_id)}
    >
      {cell.formula || cell.display}
    </div>
  );
}
