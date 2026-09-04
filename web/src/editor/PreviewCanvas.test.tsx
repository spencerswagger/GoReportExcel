import { fireEvent, render, screen } from '@testing-library/react';
import PreviewCanvas from './PreviewCanvas';
import { fixtureSchema } from '../api/mock';

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

test('renders merged anchor cells with rowSpan', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  // {r1:2,r2:7,c:1} → 大区列（col idx 0）锚点行 2 → rowSpan=6
  expect(container.querySelector('td[data-cell="r2c0"]')?.getAttribute('rowspan')).toBe('6');
  // {r1:2,r2:4,c:2} → 城市列（col idx 1）锚点行 2 → rowSpan=3
  expect(container.querySelector('td[data-cell="r2c1"]')?.getAttribute('rowspan')).toBe('3');
});

test('skips non-anchor merged cells', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} />);
  // row 3 的大区列（col 0）被 {r1:2,r2:7,c:1} 的 rowSpan 覆盖，不应渲染 td
  expect(container.querySelector('td[data-cell="r3c0"]')).toBeNull();
});

test('triggers onSelect when a cell is clicked', () => {
  const onSelect = vi.fn();
  const { container } = render(<PreviewCanvas schema={fixtureSchema} onSelect={onSelect} />);
  fireEvent.click(container.querySelector('td[data-cell="r2c1"]')!);
  expect(onSelect).toHaveBeenCalledWith('r2c1');
});

test('highlights selected cell with cell-selected class', () => {
  const { container } = render(<PreviewCanvas schema={fixtureSchema} selectedCell="r5c2" />);
  expect(container.querySelector('td[data-cell="r5c2"]')?.className).toContain('cell-selected');
});
