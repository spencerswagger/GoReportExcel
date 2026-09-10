import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EditorLayout from './EditorLayout';
import { useEditorStore } from '../store/editor';

// jsdom 不需要真实 S2 canvas，mock PreviewSheet 仅验证 props.schema 传入即可
vi.mock('../s2/PreviewSheet', () => ({
  default: (props: { schema?: { report?: { row_total?: number } } }) => (
    <div data-testid="preview-sheet-mock">{(props.schema?.report?.row_total ?? '')}</div>
  ),
}));

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
  await waitFor(() => { expect(screen.getByTestId('preview-sheet-mock')).toBeTruthy(); });
  expect(screen.getByText(/11 ROWS/)).toBeTruthy();
});

test('theme dropdown applies finance theme on select', async () => {
  render(
    <MemoryRouter initialEntries={['/editor/rpt_sales']}>
      <Routes>
        <Route path="/editor/:id" element={<EditorLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(useEditorStore.getState().draft).not.toBeNull());
  // 打开主题下拉
  fireEvent.click(screen.getByText('主题'));
  // 展开后选中"套用财务报告风"菜单项
  const item = await screen.findByText(/套用财务报告风/);
  fireEvent.click(item);
  const d = useEditorStore.getState().draft as unknown as { style_rules: { rules: unknown[] } };
  expect(d.style_rules.rules.length).toBeGreaterThan(0);
});

test('toolbar exposes undo/redo and publish actions', async () => {
  render(
    <MemoryRouter initialEntries={['/editor/rpt_sales']}>
      <Routes>
        <Route path="/editor/:id" element={<EditorLayout />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(useEditorStore.getState().draft).not.toBeNull());
  expect(screen.getByText('撤销')).toBeTruthy();
  expect(screen.getByText('重做')).toBeTruthy();
  expect(screen.getByText('发布')).toBeTruthy();
  expect(screen.getByText('导出')).toBeTruthy();
  expect(screen.getByText('历史版本')).toBeTruthy();
  expect(screen.getByText('已保存')).toBeTruthy();
});

test('hierarchy segmented persists preview.hierarchy_type into draft and undo restores', async () => {
  render(
    <MemoryRouter initialEntries={['/editor/rpt_sales']}>
      <Routes><Route path="/editor/:id" element={<EditorLayout />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(useEditorStore.getState().draft).not.toBeNull());
  const d0 = useEditorStore.getState().draft as unknown as { preview?: { hierarchy_type?: string } };
  expect(d0.preview?.hierarchy_type ?? 'grid').toBe('grid'); // 默认
  fireEvent.click(screen.getByText('tree'));
  await waitFor(() => {
    const d = useEditorStore.getState().draft as unknown as { preview?: { hierarchy_type?: string } };
    expect(d.preview?.hierarchy_type).toBe('tree');
  });
  fireEvent.click(screen.getByText('撤销'));
  await waitFor(() => {
    const d = useEditorStore.getState().draft as unknown as { preview?: { hierarchy_type?: string } };
    expect(d.preview?.hierarchy_type ?? 'grid').toBe('grid');
  });
});