import { describe, expect, it } from 'vitest';
import { styleSheetCSS } from './StyleSheet';

const styles = {
  s1: { BorderTop: 'hair', BorderRight: '', BorderBottom: 'medium', BorderLeft: 'hair', Fill: '#F5F7FA', FontColor: '', Bold: false, RowHeight: 0, Indent: 1 },
  s2: { BorderTop: '', BorderRight: '', BorderBottom: '', BorderLeft: '', Fill: '', FontColor: '#C0392B', Bold: true, RowHeight: 0, Indent: 0 },
};

describe('StyleSheet', () => {
  it('emits one css class per style id', () => {
    const css = styleSheetCSS(styles);
    expect(css).toContain('.st-s1');
    expect(css).toContain('.st-s2');
  });

  it('maps borders with line widths and fills', () => {
    const css = styleSheetCSS(styles);
    expect(css).toContain('border-top: 0.5pt solid #D9D9D9');
    expect(css).toContain('border-bottom: 2px solid #404040');
    expect(css).toContain('background-color: #F5F7FA');
  });

  it('maps indent to padding-left', () => {
    const css = styleSheetCSS(styles);
    expect(css).toContain('padding-left: 10px');
  });
});
