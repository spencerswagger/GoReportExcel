import { useEffect, useMemo, useRef } from 'react';
import { SheetComponent, type SheetComponentOptions } from '@antv/s2-react';
import type { S2Theme, TargetCellInfo, ViewMeta } from '@antv/s2';
import '@antv/s2-react/dist/s2-react.min.css';
import type { RenderSchema } from '../api/types';
import type { PreviewHierarchyType } from './hierarchy';
import { buildPreview, type PreviewRecord } from './transform';
import {
  ReportDataCell, ReportRowCell, ReportColCell,
  makeCellLookup, setCellStyleLookup, setSelectedCell,
} from './customCells';
import { buildBaseTheme } from './s2Theme';

interface Props {
  schema: RenderSchema;
  hierarchyType?: PreviewHierarchyType;
  selectedCell?: string | null;
  zoom?: number;
  onSelect?: (cellId: string) => void;
}

// 点击回溯所需的 meta 关键字段（ViewMeta / Node 子集）
interface ClickMeta {
  rowIndex?: number;
  field?: string;
  valueField?: string;
  __cellId?: string;
}

export default function PreviewSheet({ schema, hierarchyType = 'grid', zoom = 1, selectedCell, onSelect }: Props) {
  const model = useMemo(() => buildPreview(schema, hierarchyType), [schema, hierarchyType]);
  const lookup = useMemo(() => makeCellLookup(model), [model]);
  const s2Ref = useRef<object | null>(null);

  // 元信息 → cell_id：优先命中已注入的 __cellId，否则按 record 索引 + 字段名回查记录
  const resolveCellId = (meta: ClickMeta): string | undefined => {
    if (meta.__cellId) return meta.__cellId;
    if (meta.rowIndex === undefined || meta.rowIndex < 0) return undefined;
    const rec = model.records[meta.rowIndex] as PreviewRecord | undefined;
    if (!rec) return undefined;
    const field = meta.valueField ?? meta.field;
    if (!field) return undefined;
    return rec.__cellIds[field] ?? rec.__dimCellIds[field];
  };

  // 自定 data/row/col 单元格渲染，并对数据格 meta 注入 __cellId（customCells 读取）
  // 行/列头为 Node 元信息（无 ViewMeta 的 rowIndex/valueField），暂依赖点击时回查
  // 把 lookup 的绑定时机提前到 cell 工厂闭包内：s2-react 的 useSpreadSheet 先 await s2.render()
  // 再调 onMounted，而单元格类在 render 阶段读 getCellStyleLookup(this.spreadsheet) 得到 undefined，
  // 导致逐格样式（填充/边框/缩进/加粗）首屏缺位。工厂在 cell 构造期间执行，先绑定后构造可保证首帧命中。
  const options = useMemo<SheetComponentOptions>(() => ({
    ...model.options,
    dataCell: (viewMeta, s2) => {
      setCellStyleLookup(s2, lookup);
      return new ReportDataCell(viewMeta, s2);
    },
    rowCell: (node, s2, headerConfig) => {
      setCellStyleLookup(s2, lookup);
      return new ReportRowCell(node, s2, headerConfig);
    },
    colCell: (node, s2, headerConfig) => {
      setCellStyleLookup(s2, lookup);
      return new ReportColCell(node, s2, headerConfig);
    },
    layoutCellMeta: (viewMeta: ViewMeta) => {
      const cellId = resolveCellId(viewMeta as ClickMeta);
      if (cellId) (viewMeta as ViewMeta & { __cellId: string }).__cellId = cellId;
      return viewMeta;
    },
  }), [model, lookup]);

  // 点击回调：把 S2 单元格元信息回溯到业务 cell_id 并交给上层
  const handleCellClick = (data: TargetCellInfo): void => {
    const cellId = resolveCellId(data.viewMeta as ClickMeta);
    if (cellId && onSelect) onSelect(cellId);
  };

  const handleMounted = (instance: object): void => {
    setCellStyleLookup(instance, lookup);
    s2Ref.current = instance;
  };

  // 选中变化 → 按实例传导并轻量重绘，使数据格选中高亮（金色描边）即时显现
  useEffect(() => {
    if (s2Ref.current) {
      setSelectedCell(s2Ref.current, selectedCell ?? null);
      (s2Ref.current as unknown as { render?: (re?: boolean) => Promise<void> | void }).render?.(false);
    }
  }, [selectedCell]);

  return (
    <div
      data-testid="preview-sheet"
      style={{
        width: `${100 / zoom}%`,
        height: `${100 / zoom}%`,
        transform: `scale(${zoom})`,
        transformOrigin: 'top left',
      }}
    >
      {/* buildBaseTheme 返回 Partial<S2Theme>，运行时合并 S2 默认主题，断言仅为过类型 */}
      <SheetComponent
        sheetType={model.sheetType}
        dataCfg={model.dataCfg}
        options={options}
        themeCfg={{ theme: buildBaseTheme() as S2Theme }}
        adaptive
        onMounted={handleMounted}
        onDataCellClick={handleCellClick}
        onRowCellClick={handleCellClick}
        onColCellClick={handleCellClick}
      />
    </div>
  );
}