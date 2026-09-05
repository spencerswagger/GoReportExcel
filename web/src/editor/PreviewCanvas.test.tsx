import { fireEvent, render, screen } from '@testing-library/react';
import PreviewCanvas from './PreviewCanvas';
import { fixtureSchema } from '../api/mock';
import type { RenderSchema, RowDTO } from '../api/types';

// jsdom 无布局引擎：offsetHeight/offsetWidth 恒为 0，TanStack Virtual 的 getRect()
// 读到视口高度 0 → calculateRange 返回 null → 渲染 0 行。
// 这里 mock 这两个 getter 返回固定视口尺寸（600x800），使虚拟器渲染出包含目标行的窗口
// （fixture 共 11 行 x 24px = 264px < 600px，故全部行都会渲染）。
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// 复制扩展 fixture：构造 rowCount 行的全量 schema（含稀疏 cells）
function buildBigSchema(rowCount: number): RenderSchema {
  const rows: RowDTO[] = [];
  for (let i = 1; i <= rowCount; i++) {
    rows.push({
      idx: i,
      type: i === 1 ? 'header' : 'detail',
      cells: [
        { col: 0, cell_id: `r${i}c0`, value: '华东', display: '华东', style: 's2' },
        { col: 1, cell_id: `r${i}c1`, value: '上海', display: '上海', style: 's2' },
        { col: 2, cell_id: `r${i}c2`, value: i, display: String(i), style: 's2' },
        { col: 3, cell_id: `r${i}c3`, value: i, display: String(i), style: 's2' },
      ],
    });
  }
  return { ...fixtureSchema, rows };
}

test('renders header and body rows from schema', () => {
  render(<PreviewCanvas schema={fixtureSchema} />);
  expect(screen.getByText('大区')).toBeTruthy();
  expect(screen.getAllByText(/华东/).length).toBeGreaterThan(0);
  expect(screen.getByText('=SUBTOTAL(9,C2:C3)')).toBeTruthy();
});

test('emits style tags from schema dict', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  expect(container.querySelector('style')?.textContent).toContain('.st-');
});

test('renders merged anchor cells with data-merge attributes', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  // {r1:2,r2:7,c:1} → 大区列（col idx 0）锚点行 2 → data-merge-from=2 / data-merge-to=7
  const region = container.querySelector('[data-cell="r2c0"]');
  expect(region?.getAttribute('data-merge-from')).toBe('2');
  expect(region?.getAttribute('data-merge-to')).toBe('7');
  // {r1:2,r2:4,c:2} → 城市列（col idx 1）锚点行 2 → data-merge-from=2 / data-merge-to=4
  const city = container.querySelector('[data-cell="r2c1"]');
  expect(city?.getAttribute('data-merge-from')).toBe('2');
  expect(city?.getAttribute('data-merge-to')).toBe('4');
});

test('skips non-anchor merged cells', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  // row 3 的大区列（col 0）被 {r1:2,r2:7,c:1} 覆盖，非锚点行不渲染该列 cell（无重复文本）
  expect(container.querySelector('[data-cell="r3c0"]')).toBeNull();
  // row 3 的城市列（col 1）被 {r1:2,r2:4,c:2} 覆盖，同样不渲染
  expect(container.querySelector('[data-cell="r3c1"]')).toBeNull();
});

test('renders placeholder divs for non-anchor merged rows inheriting anchor style', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  // row 3 大区列（col 0）覆盖行：无 data-cell，但渲染带 data-merge-from/to 的占位 div
  const placeholder = container.querySelector('[data-merge-from="2"][data-merge-to="7"]:not([data-cell])');
  expect(placeholder).toBeTruthy();
  // 占位 div 继承锚点样式类（锚点 r2c0 的 style 为 s2）
  expect(placeholder?.className).toContain('st-s2');
});

test('triggers onSelect when a cell is clicked', () => {
  const onSelect = vi.fn();
  const { container } = render(<PreviewCanvas schema={fixtureSchema} onSelect={onSelect} />);
  fireEvent.click(container.querySelector('[data-cell="r2c1"]')!);
  expect(onSelect).toHaveBeenCalledWith('r2c1');
});

test('highlights selected cell with cell-selected class', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} selectedCell="r5c2" />);
  expect(container.querySelector('[data-cell="r5c2"]')?.className).toContain('cell-selected');
});

test('virtualizes large schemas: renders only viewport rows with correct offsets and total size', () => {
  // 覆盖 beforeAll 的 600x800 mock：小视口下只渲染窗口内行（本用例放最后，不影响既有用例）
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
  const big = buildBigSchema(1000);
  const { container } = render(<PreviewCanvas schema={big} />);
  const rows = container.querySelectorAll('[data-row]');
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(100); // 远小于 1000，仅渲染窗口内行
  // getTotalSize = 1000 行 × 24px
  const inner = container.querySelector('[data-testid="virtual-canvas"]') as HTMLElement;
  expect(inner.style.height).toBe('24000px');
  // 首行定位在 translateY(0px)，后续行按 24px 递增
  const first = rows[0] as HTMLElement;
  expect(first.style.transform).toContain('translateY(0px)');
  const second = rows[1] as HTMLElement;
  expect(second.style.transform).toContain('translateY(24px)');
});
