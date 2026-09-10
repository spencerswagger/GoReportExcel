import { useMemo } from 'react';
import { SheetComponent, type SheetComponentOptions } from '@antv/s2-react';
import type { S2Theme, TargetCellInfo, ViewMeta } from '@antv/s2';
import '@antv/s2-react/dist/s2-react.min.css';
import type { RenderSchema } from '../api/types';
import type { PreviewHierarchyType } from './hierarchy';
import { buildPreview, type PreviewRecord } from './transform';
import {
  ReportDataCell, ReportRowCell, ReportColCell,
  makeCellLookup, setCellStyleLookup,
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

export default function PreviewSheet({ schema, hierarchyType = 'grid', zoom = 1, onSelect }: Props) {
  const model = useMemo(() => buildPreview(schema, hierarchyType), [schema, hierarchyType]);
  const lookup = useMemo(() => makeCellLookup(model), [model]);

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
  const options = useMemo<SheetComponentOptions>(() => ({
    ...model.options,
    dataCell: (viewMeta, s2) => new ReportDataCell(viewMeta, s2),
    rowCell: (node, s2, headerConfig) => new ReportRowCell(node, s2, headerConfig),
    colCell: (node, s2, headerConfig) => new ReportColCell(node, s2, headerConfig),
    layoutCellMeta: (viewMeta: ViewMeta) => {
      const cellId = resolveCellId(viewMeta as ClickMeta);
      if (cellId) (viewMeta as ViewMeta & { __cellId: string }).__cellId = cellId;
      return viewMeta;
    },
  }), [model]);

  // 点击回调：把 S2 单元格元信息回溯到业务 cell_id 并交给上层
  const handleCellClick = (data: TargetCellInfo): void => {
    const cellId = resolveCellId(data.viewMeta as ClickMeta);
    if (cellId && onSelect) onSelect(cellId);
  };

  const handleMounted = (instance: object): void => {
    setCellStyleLookup(instance, lookup);
  };

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