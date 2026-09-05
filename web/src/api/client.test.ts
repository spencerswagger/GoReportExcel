import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mock-server';
import { getVersions, putDraft, submitExport } from './client';
import type { VersionInfo } from './types';

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

  it('submits export and returns task id', async () => {
    const res = await submitExport({ def_id: 'rpt_sales' });
    expect(res.task_id).toBeTruthy();
  });

  it('maps 409 draft conflict to typed error', async () => {
    server.use(
      http.put('*/api/v1/definitions/r1/draft', () =>
        HttpResponse.json({ error: 'draft conflict: base version outdated' }, { status: 409 }),
      ),
    );
    await expect(putDraft('r1', '{"version":1}')).rejects.toThrow(/409/);
  });
});
