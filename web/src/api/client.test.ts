import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mock-server';
import { createDataSource, getVersions, putDraft, submitExport } from './client';
import type { VersionInfo } from './types';

const ORDERS_CSV = [
  'order_id,order_date,region,city,channel,customer,product,amount,qty',
  'SO-1,2026-06-04,华南,广州,线上,客户A,Mac mini M2,2249,1',
  'SO-2,2026-08-09,华南,厦门,门店,客户B,iPhone 15,1603,1',
].join('\n');

describe('api client', () => {
  it('GET versions parses list', async () => {
    const vs: VersionInfo[] = await getVersions('rpt_sales');
    expect(vs.length).toBeGreaterThanOrEqual(1);
    expect(vs[0]).toMatchObject({ version: 2, status: 'published' });
  });

  it('PUT draft forwards body and ok', async () => {
    const ok = await putDraft('rpt_sales', '{"id":"rpt_sales","version":2}');
    expect(ok).toBe(true);
  });

  it('putDraft 携带 preview 键不被丢弃（mock 原样接受）', async () => {
    const payload = JSON.stringify({ id: 'r', version: 2, preview: { hierarchy_type: 'tree' } });
    await expect(putDraft('r', payload)).resolves.toBe(true);
  });

  it('submits export and returns task id', async () => {
    const res = await submitExport({ def_id: 'rpt_sales' });
    expect(res.task_id).toBeTruthy();
  });

  it('maps 409 draft conflict to typed error', async () => {
    server.use(
      http.put('*/v1/definitions/r1/draft', () =>
        HttpResponse.json({ error: 'draft conflict: base version outdated' }, { status: 409 }),
      ),
    );
    await expect(putDraft('r1', '{"version":1}')).rejects.toThrow(/409/);
  });

  it('uploads csv as datasource and parses fields/rows', async () => {
    const source = await createDataSource({ name: '上传测试', file_name: 'orders.csv', content: ORDERS_CSV });
    expect(source.kind).toBe('csv');
    expect(source.tables).toContain('orders.csv');
    expect(source.detail).toContain('2 行 × 9 列');
  });
});
