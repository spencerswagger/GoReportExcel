import { fireEvent, render, screen } from '@testing-library/react';
import PreviewCanvas from './PreviewCanvas';
import { fixtureSchema } from '../api/mock';

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
