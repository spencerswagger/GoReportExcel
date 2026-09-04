import type { ResolvedStyle } from '../api/types';

// 线型 → CSS（设计文档 16.4 映射表）
const lineCSS: Record<string, string> = {
  hair: '0.5pt solid #D9D9D9',
  thin: '1px solid #BFBFBF',
  medium: '2px solid #404040',
  thick: '3px solid #000000',
  double: '3px double #000000',
  dashed: '1px dashed #8C8C8C',
};

export function styleSheetCSS(styles: Record<string, ResolvedStyle>): string {
  const blocks: string[] = [];
  for (const [id, st] of Object.entries(styles)) {
    const parts: string[] = [];
    const borders: Array<[string, string]> = [
      ['border-top', st.BorderTop], ['border-right', st.BorderRight],
      ['border-bottom', st.BorderBottom], ['border-left', st.BorderLeft],
    ];
    for (const [prop, line] of borders) {
      if (line && lineCSS[line]) parts.push(`${prop}: ${lineCSS[line]};`);
    }
    if (st.Fill) parts.push(`background-color: ${st.Fill};`);
    if (st.Bold) parts.push(`font-weight: 700;`);
    if (st.FontColor) parts.push(`color: ${st.FontColor};`);
    if (st.Indent > 0) parts.push(`padding-left: ${st.Indent * 10}px;`);
    blocks.push(`.st-${id}{${parts.join('')}}`);
  }
  return blocks.join('\n');
}
