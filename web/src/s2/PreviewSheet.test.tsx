import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixtureSchema } from '../api/mock';
import PreviewSheet from './PreviewSheet';

// 说明（暂不引入脆测）：逐格样式 lookup 的绑定时机被提前到 options 的
// dataCell/rowCell/colCell 工厂闭包内，使其在 cell 构造期间（render 阶段）就先于
// getCellStyleLookup(this.spreadsheet) 的读取而被命中，避免 s2-react 先 await render()
// 再触发 onMounted 造成的首屏 lookup undefined。jsdom 下难以真实驱动 S2 渲染，
// 因此这里不额外断言工厂时序，避免脆测；运行时路径由 onMounted 冗余兜底保证。

describe('PreviewSheet', () => {
  it('pivot 挂载不抛错，渲染容器存在', () => {
    const { container } = render(<PreviewSheet schema={fixtureSchema} />);
    expect(container.querySelector('[data-testid="preview-sheet"]')).toBeTruthy();
  });

  it('table（0 维度）挂载不抛错', () => {
    const schema = structuredClone(fixtureSchema);
    schema.cols = schema.cols.filter((c) => c.role === 'metric').map((c, i) => ({ ...c, idx: i }));
    schema.rows = schema.rows.map((r) => ({
      ...r,
      cells: r.cells.filter((c) => c.col >= 2).map((c) => ({ ...c, col: c.col - 2 })),
    }));
    const { container } = render(<PreviewSheet schema={schema} />);
    expect(container.querySelector('[data-testid="preview-sheet"]')).toBeTruthy();
  });
});