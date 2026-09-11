import { useEffect, useState } from 'react';
import { Alert, Skeleton, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { fetchDataSources, fetchDatasets } from '../api/client';
import type { DataSourceInfo, DatasetInfo } from '../api/types';

const typeColor: Record<DataSourceInfo['kind'], string> = {
  csv: 'rgba(200,146,62,.14)',
  db: 'rgba(74,109,140,.14)',
  excel: 'rgba(78,138,90,.14)',
};

const fieldTypeColor: Record<string, string> = {
  string: 'geekblue',
  number: 'green',
  date: 'purple',
  boolean: 'orange',
};

export default function Datasets() {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDataSources(), fetchDatasets()])
      .then(([s, d]) => {
        if (cancelled) return;
        setSources(s);
        setDatasets(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => { cancelled = true; };
  }, []);

  const loading = sources === null && datasets === null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0, fontFamily: "'Noto Serif SC', serif", fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.01em' }}>
            数据管理
          </Typography.Title>
          <Typography.Text style={{ color: 'var(--ink-dim)', fontSize: 12, letterSpacing: '0.05em' }}>
            数据源与数据集 · SOURCES & DATASETS
          </Typography.Text>
        </div>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Typography.Text style={{ color: 'var(--accent-ink)' }}>← 返回报表库</Typography.Text>
        </Link>
      </div>

      {err && <Alert type="error" showIcon message="加载失败" description={err} />}

      {loading && <Skeleton active paragraph={{ rows: 4 }} />}

      {sources && (
        <>
          <div>
            <Typography.Title level={4} style={{ margin: '0 0 10px', fontFamily: "'Noto Serif SC', serif", color: 'var(--ink)' }}>
              数据源
            </Typography.Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {sources.map((s) => (
                <article key={s.id} className="ate-report-card" style={{
                  background: 'var(--paper-card)', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-l)',
                  boxShadow: 'var(--paper-shadow)', padding: 18,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />
                    <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{s.name}</span>
                    <Tag style={{ marginLeft: 'auto', background: typeColor[s.kind], color: 'var(--ink)', border: 'none' }}>
                      {s.kind.toUpperCase()}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: "'IBM Plex Mono', monospace", margin: '8px 0 10px' }}>{s.detail}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(s.tables ?? []).map((t) => <Tag key={t} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{t}</Tag>)}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <Typography.Title level={4} style={{ margin: '8px 0 10px', fontFamily: "'Noto Serif SC', serif", color: 'var(--ink)' }}>
              数据集
            </Typography.Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {(datasets ?? []).map((d) => (
                <article key={d.id} className="ate-report-card" style={{
                  background: 'var(--paper-card)', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-l)',
                  boxShadow: 'var(--paper-shadow)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{d.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-faint)' }}>
                      {d.field_count} FIELDS
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    来源：{d.source_name ?? d.source_ref} · {d.id}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--paper-line)', paddingTop: 10 }}>
                    {d.fields.map((f) => (
                      <Tag key={f.key} color={fieldTypeColor[f.type] ?? 'default'} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {f.label ?? f.key} · {f.type}
                      </Tag>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}