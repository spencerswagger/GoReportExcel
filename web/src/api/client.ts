import type {
  DataSourceInfo, DatasetInfo, ExportSubmitResult, ExplainResult, RenderRequest, RenderSchema, TaskStatus,
  TraceResult, VersionInfo,
} from './types';

const BASE = '/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, `${res.status} ${body?.error ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getDraft(id: string) {
  return req<{ version: number; payload: string }>(`/definitions/${id}/draft`);
}

export function getPublished(id: string) {
  return req<{ version: number; payload: string }>(`/definitions/${id}/published`);
}

export function putDraft(id: string, payload: string) {
  return req<{ ok: string }>(`/definitions/${id}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).then(() => true);
}

export function publish(id: string) {
  return req<{ ok: string }>(`/definitions/${id}/publish`, { method: 'POST' });
}

export function getVersions(id: string) {
  return req<VersionInfo[]>(`/definitions/${id}/versions`);
}

export function rollback(id: string, version: number) {
  return req<{ ok: string }>(`/definitions/${id}/rollback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
}

export function patchOverride(id: string, op: 'upsert' | 'delete', override: unknown) {
  return req<{ ok: string }>(`/definitions/${id}/overrides`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, override }),
  });
}

export function renderPreview(reqBody: RenderRequest) {
  return req<{ version: number; schema: RenderSchema }>('/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
}

export function styleExplain(cellId: string, defId: string) {
  return req<ExplainResult>(`/cells/${cellId}/style-explain?def_id=${encodeURIComponent(defId)}`);
}

export function dataTrace(cellId: string, defId: string) {
  return req<TraceResult>(`/cells/${cellId}/data-trace?def_id=${encodeURIComponent(defId)}`);
}

export function fetchDataSources() {
  return req<DataSourceInfo[]>('/datasources');
}

export function fetchDatasets() {
  return req<DatasetInfo[]>('/datasets');
}

export function fetchDataset(id: string) {
  return req<DatasetInfo & { sample_rows?: Array<Record<string, unknown>> }>(`/datasets/${id}`);
}

export function createDataSource(body: { name: string; file_name: string; content: string }) {
  return req<DataSourceInfo>('/datasources', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function uploadTable(sourceId: string, body: { file_name: string; content: string }) {
  return req<{ ok: string; tables: string[] }>(`/datasources/${sourceId}/tables`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteDataSource(id: string) {
  return req<{ ok: string }>(`/datasources/${id}`, { method: 'DELETE' });
}

export function createDataset(body: { name: string; source_ref: string; table?: string }) {
  return req<DatasetInfo>('/datasets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteDataset(id: string) {
  return req<{ ok: string }>(`/datasets/${id}`, { method: 'DELETE' });
}

export function submitExport(body: { def_id: string; version?: number; idempotency_key?: string }) {
  return req<ExportSubmitResult>('/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function exportStatus(taskId: string) {
  return req<TaskStatus>(`/export/${taskId}`);
}

export function exportDownloadUrl(taskId: string, defId?: string) {
  return `${BASE}/export/${taskId}/download${defId ? `?def_id=${encodeURIComponent(defId)}` : ''}`;
}
