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

// 无边框样式时的默认网格线，保证单元格仍有可见边框
const DEFAULT_BORDER = 'border: 1px solid #e0e0e0;';

// 常见 CSS 颜色名白名单（纵深防御：后端可控颜色值不直接拼进 CSS）
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink',
  'gray', 'grey', 'silver', 'maroon', 'navy', 'teal', 'olive', 'lime', 'aqua',
  'fuchsia', 'transparent', 'currentcolor',
]);

function isSafeColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true;
  return NAMED_COLORS.has(v);
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

export function styleSheetCSS(styles: Record<string, ResolvedStyle>): string {
  const blocks: string[] = [];
  for (const [id, st] of Object.entries(styles)) {
    if (!isSafeId(id)) continue;
    const parts: string[] = [];
    const borders: Array<[string, string]> = [
      ['border-top', st.BorderTop], ['border-right', st.BorderRight],
      ['border-bottom', st.BorderBottom], ['border-left', st.BorderLeft],
    ];
    let anyBorder = false;
    for (const [prop, line] of borders) {
      if (line && lineCSS[line]) {
        parts.push(`${prop}: ${lineCSS[line]};`);
        anyBorder = true;
      }
    }
    // 四个边框都未设置时补默认边框，保证网格线可见
    if (!anyBorder) parts.push(DEFAULT_BORDER);
    if (st.Fill && isSafeColor(st.Fill)) parts.push(`background-color: ${st.Fill};`);
    if (st.Bold) parts.push(`font-weight: 700;`);
    if (st.FontColor && isSafeColor(st.FontColor)) parts.push(`color: ${st.FontColor};`);
    if (st.Indent > 0) parts.push(`padding-left: ${st.Indent * 10}px;`);
    blocks.push(`.st-${id}{${parts.join('')}}`);
  }
  return blocks.join('\n');
}
