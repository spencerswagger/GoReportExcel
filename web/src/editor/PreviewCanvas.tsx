import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColInfo, MergeInfo, RenderSchema, RowDTO } from '../api/types';
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
    // 行高优先取 row.height，未设置时回退默认行高
    estimateSize: (i) => schema.rows[i]?.height || rowHeight,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();

  // merges 按 0-based 列号预索引，避免每列线性扫描全部 merges
  const mergeByCol = useMemo(() => {
    const map = new Map<number, MergeInfo[]>();
    for (const m of schema.merges) {
      const col = m.c - 1;
      const arr = map.get(col);
      if (arr) arr.push(m);
      else map.set(col, [m]);
    }
    return map;
  }, [schema.merges]);

  // 用 textContent 写入 CSS，避免 dangerouslySetInnerHTML 解析 HTML 造成 XSS
  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = css + SELECTED_CSS;
  }, [css]);

  return (
    <div ref={scrollRef} className="preview-canvas" style={{ overflow: 'auto', height: '100%' }}>
      <style ref={styleRef} />
      <div data-testid="virtual-canvas" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((vi) => {
          const row = schema.rows[vi.index];
          const h = row.height || rowHeight;
          // 稀疏 cells 按 col 建索引，避免每列线性查找
          const cellMap = new Map(row.cells.map((c) => [c.col, c]));
          return (
            <div key={row.idx} data-row={row.idx}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${vi.start}px)`, height: h, display: 'flex',
              }}>
              {schema.cols.map((col) => {
                const cell = cellMap.get(col.idx);
                const m = mergeOf(mergeByCol, col.idx, row.idx);
                const width = (col.width ?? 0) * 7;
                // 合并区间内的覆盖行（非锚点）：渲染无文本占位 div，继承锚点样式，
                // 保证锚点行滚出窗口时合并区背景/边框仍视觉连续
                if (!m.anchor) {
                  const anchorStyle = schema.rows[m.r1]?.cells.find((c) => c.col === col.idx)?.style;
                  return (
                    <div key={col.idx}
                      data-merge-from={m.r2 > m.r1 ? m.r1 : undefined}
                      data-merge-to={m.r2 > m.r1 ? m.r2 : undefined}
                      className={`st-${anchorStyle}`}
                      style={{
                        width, minWidth: width, height: h, boxSizing: 'border-box', flexShrink: 0,
                      }}
                    />
                  );
                }
                if (!cell) return null;
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

// merges 已按 0-based 列号索引；col 为 0-based 列索引
function mergeOf(mergeByCol: Map<number, MergeInfo[]>, col: number, rowIdx: number): MergeResult {
  const list = mergeByCol.get(col);
  if (list) {
    for (const m of list) {
      if (rowIdx >= m.r1 && rowIdx <= m.r2) {
        return { anchor: rowIdx === m.r1, r1: m.r1, r2: m.r2 };
      }
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
        display: 'flex', alignItems: 'center',
      }}
      title={cell.formula || cell.display}
      onClick={() => onSelect?.(cell.cell_id)}
    >
      {cell.formula || cell.display}
    </div>
  );
}
