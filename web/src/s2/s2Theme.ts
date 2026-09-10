import type { S2Theme } from '@antv/s2';

// 基础主题：行头/列头/角头左对齐，其余走 S2 默认（逐格样式由 customCells 覆盖）
export function buildBaseTheme(): Partial<S2Theme> {
  return {
    rowCell: { text: { textAlign: 'left' }, bolderText: { textAlign: 'left' } },
    colCell: { text: { textAlign: 'left' }, bolderText: { textAlign: 'left' } },
    cornerCell: { text: { textAlign: 'left' } },
  };
}
