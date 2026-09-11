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

test('download endpoint returns real xlsx workbook (not SPA fallback)', async () => {
  const res = await fetch('/v1/export/task-1/download?def_id=rpt_sales');
  expect(res.ok).toBe(true);
  expect(res.headers.get('Content-Type')).toContain('spreadsheetml');
  const buf = Buffer.from(await res.arrayBuffer());
  // xlsx 是 zip 容器（PK 头），且体积说明包含真实内容
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 2).toString()).toBe('PK');
});

test('POST download 按当前 payload 生成：多维度导出为多列 Excel', async () => {
  const payload = {
    id: 'rpt_new', version: 2, name: '新建报表',
    dataset: { id: 'ds_sales', source_ref: 'csv_local', fields: [] },
    dimensions: [
      { field: 'region', label: '大区', axis: 'row', sort: { by: 'sort_key', dir: 'asc' } },
      { field: 'city', label: '城市', axis: 'row', sort: { by: 'sort_key', dir: 'asc' } },
    ],
    metrics: [{ field: 'amount', label: '销售额', agg: 'SUM', num_fmt_ref: 'money' }],
  };
  const res = await fetch('/v1/export/task-1/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ def_id: 'rpt_new', payload }),
  });
  expect(res.ok).toBe(true);
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.worksheets[0];
  // 表头同时包含两个维度与指标
  const header = (ws.getRow(1).values as string[]).filter(Boolean).join(',');
  expect(header).toContain('大区');
  expect(header).toContain('城市');
  expect(header).toContain('销售额');
  // 存在明细数据行
  expect(ws.actualRowCount).toBeGreaterThan(2);
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
