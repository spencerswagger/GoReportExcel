import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Inspector } from './Inspector';
import { useEditorStore } from '../store/editor';
import { server } from '../api/mock';

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
    expect(screen.getByText(/来源行数/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
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

test('shows hint when no cell selected', () => {
  const s = useEditorStore.getState();
  s.selectCell(null);
  render(<Inspector />);
  expect(screen.getByText('点击预览中的单元格查看详情')).toBeTruthy();
});

test('shows error alert when patch fails', async () => {
  server.use(
    http.patch('*/api/v1/definitions/:id/overrides', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  );
  render(<Inspector />);
  await waitFor(() => expect(screen.getByText(/zebra/)).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /调整此单元格样式/ }));
  await waitFor(() => {
    expect(screen.getByText('应用失败')).toBeTruthy();
  });
});
