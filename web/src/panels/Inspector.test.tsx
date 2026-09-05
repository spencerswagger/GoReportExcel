import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Inspector } from './Inspector';
import { useEditorStore } from '../store/editor';

beforeEach(() => {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  s.selectCell('r4c2'); // fixture 小计行单元格
});

test('loads explains for selected cell', async () => {
  render(<Inspector />);
  await waitFor(() => {
    expect(screen.getByText(/zebra/)).toBeTruthy();
  });
  expect(screen.getByText(/row_type eq/)).toBeTruthy();
});

test('loads data trace and shows source count', async () => {
  render(<Inspector />);
  await waitFor(() => {
    expect(screen.getByText(/来源行数：2/)).toBeTruthy();
  });
});

test('style modify button patches override via api', async () => {
  render(<Inspector />);
  await waitFor(() => expect(screen.getByText(/zebra/)).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /调整此单元格样式/ }));
  await waitFor(() => {
    expect(screen.getByText(/已应用/)).toBeTruthy();
  });
});
