import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Input, Modal, Popconfirm, Select, Skeleton, Table, Tag, Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import {
  createDataSource, createDataset, deleteDataSource, deleteDataset, fetchDataset,
  fetchDataSources, fetchDatasets, uploadTable,
} from '../api/client';
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

const pickFile = (accept: string, onPick: (f: File) => void) => (
  <label
    className="ate-filesel"
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '9px 12px', borderRadius: 'var(--radius-s)', cursor: 'pointer',
      border: '1px dashed var(--paper-line)', background: 'var(--paper-bg)',
      color: 'var(--accent-ink)', fontSize: 13, transition: 'border-color .15s',
    }}
  >
    ⇪ 选择 CSV 文件
    <input
      type="file"
      accept={accept}
      data-testid="csv-file"
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f as File);
        e.target.value = '';
      }}
    />
  </label>
);

export default function Datasets() {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 新建数据源
  const [srcModal, setSrcModal] = useState(false);
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [srcName, setSrcName] = useState('');
  // 数据源加表
  const [uploadFor, setUploadFor] = useState<DataSourceInfo | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // 新建数据集
  const [dsModal, setDsModal] = useState(false);
  const [dsName, setDsName] = useState('');
  const [dsSource, setDsSource] = useState<string | undefined>();
  const [dsTable, setDsTable] = useState<string | undefined>();
  // 样例预览
  const [sampleFor, setSampleFor] = useState<(DatasetInfo & { sample_rows?: Array<Record<string, unknown>> }) | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([fetchDataSources(), fetchDatasets()])
      .then(([s, d]) => {
        if (cancelled) return;
        setSources(s);
        setDatasets(d);
        setErr(null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  const createSource = async () => {
    if (!srcFile) return;
    setSaving(true);
    try {
      await createDataSource({
        name: srcName.trim() || '未命名数据源',
        file_name: srcFile.name,
        content: await srcFile.text(),
      });
      setSrcModal(false);
      setSrcName('');
      setSrcFile(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const doUploadTable = async () => {
    if (!uploadFor || !uploadFile) return;
    setSaving(true);
    try {
      await uploadTable(uploadFor.id, { file_name: uploadFile.name, content: await uploadFile.text() });
      setUploadFor(null);
      setUploadFile(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setSaving(false);
    }
  };

  const createDs = async () => {
    if (!dsSource || !dsTable) return;
    setSaving(true);
    try {
      await createDataset({ name: dsName.trim() || '新数据集', source_ref: dsSource, table: dsTable });
      setDsModal(false);
      setDsName('');
      setDsSource(undefined);
      setDsTable(undefined);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteSource = async (id: string) => {
    try { await deleteDataSource(id); load(); } catch (e) { setErr(e instanceof Error ? e.message : '删除失败'); }
  };

  const onDeleteDataset = async (id: string) => {
    try { await deleteDataset(id); load(); } catch (e) { setErr(e instanceof Error ? e.message : '删除失败'); }
  };

  const openSample = async (d: DatasetInfo) => {
    setSampleLoading(true);
    setSampleFor({ ...d });
    try {
      const detail = await fetchDataset(d.id);
      setSampleFor(detail);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取样例失败');
    } finally {
      setSampleLoading(false);
    }
  };

  const loading = sources === null && datasets === null;

  const dsTableOptions = useMemo(
    () => (sources ?? []).find((s) => s.id === dsSource)?.tables?.map((t) => ({ value: t, label: t })) ?? [],
    [sources, dsSource],
  );

  const sampleCols = useMemo(
    () => (sampleFor?.sample_rows?.[0] ? Object.keys(sampleFor.sample_rows[0]).map((k) => ({ title: k, dataIndex: k, key: k })) : []),
    [sampleFor],
  );

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

      {err && <Alert type="error" showIcon message="操作失败" description={err} closable onClose={() => setErr(null)} />}

      {loading && <Skeleton active paragraph={{ rows: 4 }} />}

      {sources && (
        <>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 10px' }}>
              <Typography.Title level={4} style={{ margin: 0, fontFamily: "'Noto Serif SC', serif", color: 'var(--ink)' }}>
                数据源
              </Typography.Title>
              <Button size="small" type="primary" ghost style={{ marginLeft: 'auto', borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                onClick={() => setSrcModal(true)}>
                ＋ 新建数据源
              </Button>
            </div>
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
                    <Popconfirm title="删除该数据源？" okText="删除" cancelText="取消" onConfirm={() => onDeleteSource(s.id)}>
                      <Button type="text" size="small" aria-label={`删除数据源 ${s.name}`} style={{ color: 'var(--ink-faint)' }}>×</Button>
                    </Popconfirm>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: "'IBM Plex Mono', monospace", margin: '8px 0 4px' }}>{s.detail}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {(s.tables ?? []).map((t) => <Tag key={t} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{t}</Tag>)}
                    <Button type="link" size="small" style={{ fontSize: 12, color: 'var(--accent-ink)', padding: 0 }} onClick={() => setUploadFor(s)}>
                      ＋ 上传表
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0 10px' }}>
              <Typography.Title level={4} style={{ margin: 0, fontFamily: "'Noto Serif SC', serif", color: 'var(--ink)' }}>
                数据集
              </Typography.Title>
              <Button size="small" type="primary" ghost style={{ marginLeft: 'auto', borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                onClick={() => setDsModal(true)}>
                ＋ 新建数据集
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {(datasets ?? []).map((d) => (
                <article key={d.id} className="ate-report-card" style={{
                  background: 'var(--paper-card)', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-l)',
                  boxShadow: 'var(--paper-shadow)', padding: 18, display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{d.name}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-faint)' }}>
                      {d.field_count} FIELDS
                    </span>
                    <Popconfirm title="删除该数据集？" okText="删除" cancelText="取消" onConfirm={() => onDeleteDataset(d.id)}>
                      <Button type="text" size="small" aria-label={`删除数据集 ${d.name}`} style={{ color: 'var(--ink-faint)' }}>×</Button>
                    </Popconfirm>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    来源：{d.source_name ?? d.source_ref} · {d.id}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--paper-line)', paddingTop: 8 }}>
                    {d.fields.map((f) => (
                      <Tag key={f.key} color={fieldTypeColor[f.type] ?? 'default'} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {f.label ?? f.key} · {f.type}
                      </Tag>
                    ))}
                  </div>
                  <Button type="link" size="small" style={{ padding: 0, alignSelf: 'flex-start', color: 'var(--accent-ink)', fontSize: 12 }} onClick={() => openSample(d)}>
                    查看样例数据{typeof (d as DatasetInfo & { row_count?: number }).row_count === 'number' ? `（${(d as DatasetInfo & { row_count?: number }).row_count} 行）` : ''} →
                  </Button>
                </article>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 新建数据源（上传 CSV） */}
      <Modal title="新建数据源" open={srcModal} onOk={createSource} onCancel={() => setSrcModal(false)} okText="创建" cancelText="取消" confirmLoading={saving} destroyOnClose>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Input placeholder="数据源名称（如：9 月订单 CSV）" value={srcName} onChange={(e) => setSrcName(e.target.value)} aria-label="数据源名称" />
          {pickFile('.csv', (f) => setSrcFile(f))}
          {srcFile && <Tag style={{ alignSelf: 'flex-start' }}>{srcFile.name}（{srcFile.size} 字节）</Tag>}
          {!srcFile && <div className="panel-muted" style={{ color: 'var(--ink-dim)' }}>必须上传一个 CSV 文件，将解析表头字段与数据行作为该数据源的表。</div>}
        </div>
      </Modal>

      {/* 数据源补充表 */}
      <Modal
        title={`向「${uploadFor?.name ?? ''}」上传表`}
        open={!!uploadFor}
        onOk={doUploadTable}
        onCancel={() => { setUploadFor(null); setUploadFile(null); }}
        okText="上传" cancelText="取消" confirmLoading={saving} destroyOnClose
      >
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pickFile('.csv', (f) => setUploadFile(f))}
          {uploadFile && <Tag style={{ alignSelf: 'flex-start' }}>{uploadFile.name}</Tag>}
          {!uploadFile && <div className="panel-muted" style={{ color: 'var(--ink-dim)' }}>上传的 CSV 将作为该数据源的一张新表（文件名即表名）。</div>}
        </div>
      </Modal>

      {/* 新建数据集（选择数据源 + 表） */}
      <Modal title="新建数据集" open={dsModal} onOk={createDs} onCancel={() => setDsModal(false)} okText="创建" cancelText="取消" confirmLoading={saving} destroyOnClose>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Input placeholder="数据集名称（如：9 月订单）" value={dsName} onChange={(e) => setDsName(e.target.value)} aria-label="数据集名称" />
          <Select
            placeholder="来源数据源"
            value={dsSource}
            onChange={(v) => { setDsSource(v); setDsTable(undefined); }}
            options={(sources ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.id}` }))}
          />
          <Select
            placeholder="选择该数据源中的表（CSV 文件）"
            value={dsTable}
            onChange={setDsTable}
            options={dsTableOptions}
            disabled={!dsSource}
          />
          <div className="panel-muted" style={{ color: 'var(--ink-dim)' }}>
            字段与样例数据取自所选 CSV 表；之后进入编辑器，选中该数据集即可配置维度/指标报表。
          </div>
        </div>
      </Modal>

      {/* 数据集样例预览 */}
      <Modal
        title={`${sampleFor?.name ?? ''} · 样例数据`}
        open={!!sampleFor}
        onCancel={() => setSampleFor(null)}
        footer={null}
        width={860}
        destroyOnClose
      >
        {sampleLoading && <Skeleton active paragraph={{ rows: 3 }} />}
        {!sampleLoading && sampleFor && (
          <Table
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={sampleCols}
            dataSource={(sampleFor.sample_rows ?? []).map((r, i) => ({ key: i, ...r }))}
          />
        )}
      </Modal>
    </div>
  );
}