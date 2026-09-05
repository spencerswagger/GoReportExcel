import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EditorLayout from './EditorLayout';
import { useEditorStore } from '../store/editor';

// jsdom 无布局引擎：offsetHeight/offsetWidth 恒为 0，TanStack Virtual 的 getRect()
// 读到视口高度 0 → calculateRange 返回 null → 渲染 0 行（预览中表头"大区"等不可见）。
// 与 PreviewCanvas.test.tsx 一致，mock 这两个 getter 返回固定视口尺寸使预览渲染出表头行。
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterAll(() => {
  vi.restoreAllMocks();
});

test('loads draft and renders three columns', async () => {
  render(
    <MemoryRouter initialEntries={['/editor/rpt_sales']}>
      <Routes>
        <Route path="/editor/:id" element={<EditorLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(useEditorStore.getState().draft).not.toBeNull();
  });
  expect(screen.getByText('维度与排序')).toBeTruthy();
  expect(screen.getByText('样式规则（图层）')).toBeTruthy();
  expect(screen.getByText('检查器')).toBeTruthy();
  await waitFor(() => {
    expect(screen.getAllByText('大区').length).toBeGreaterThan(0);
  });
});

test('theme selector applies finance theme on click', async () => {
  render(
    <MemoryRouter initialEntries={['/editor/rpt_sales']}>
      <Routes>
        <Route path="/editor/:id" element={<EditorLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(useEditorStore.getState().draft).not.toBeNull());
  const apply = screen.getAllByText(/套用财务报告风/)[0];
  apply.click();
  const d = useEditorStore.getState().draft as unknown as { style_rules: { rules: unknown[] } };
  expect(d.style_rules.rules.length).toBeGreaterThan(0);
});
