import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixtureSchema } from '../api/mock';
import PreviewSheet from './PreviewSheet';

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