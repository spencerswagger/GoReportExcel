import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ExportButton } from './ExportButton';
import { server } from '../api/mock-server';

test('happy path: export then poll shows download link', async () => {
  render(<ExportButton defId="r1" />);
  fireEvent.click(screen.getByRole('button', { name: /导\s*出/ }));
  // mock 的 GET /export 立即返回 done，轮询 1s 后停止，放宽 waitFor 超时。
  await waitFor(() => {
    expect(screen.getByText('下载数据')).toBeTruthy();
  }, { timeout: 3000 });
});

test('download endpoint returns real csv file stream (not SPA fallback)', async () => {
  const res = await fetch('/v1/export/task-1/download?def_id=rpt_sales');
  expect(res.ok).toBe(true);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  const text = await res.text();
  // 表头与明细数据来自真实 schema 渲染
  expect(text).toContain('大区');
  expect(text).toContain('销售额');
  expect(text).toContain('华东');
});

test('failure path: submit export 500 shows error alert', async () => {
  server.use(
    http.post('*/v1/export', () =>
      HttpResponse.json({ error: 'boom' }, { status: 500 }),
    ),
  );
  render(<ExportButton defId="r1" />);
  fireEvent.click(screen.getByRole('button', { name: /导\s*出/ }));
  await waitFor(() => {
    expect(screen.getByText(/500 boom/)).toBeTruthy();
  }, { timeout: 3000 });
});
