import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  createDataSource, createDataset, deleteDataSource, deleteDataset,
  fetchDataSources, fetchDatasets,
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

export default function Datasets() {
  const [sources, setSources] = useState<DataSourceInfo[] | null>(null);
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [srcModal, setSrcModal] = useState(false);
  const [dsModal, setDsModal] = useState(false);
  const [srcForm] = Form.useForm();
  const [dsForm] = Form.useForm();

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

  const onCreateSource = async () => {
    const { name } = await srcForm.validateFields();
    await createDataSource({ name, kind: 'csv' });
    setSrcModal(false);
    srcForm.resetFields();
    load();
  };

  const onCreateDataset = async () => {
    const { name, source_ref, record_count } = await dsForm.validateFields();
    await createDataset({ name, source_ref, record_count });
    setDsModal(false);
    dsForm.resetFields();
    load();
  };

  const onDeleteSource = async (id: string) => {
    await deleteDataSource(id);
    load();
  };

  const onDeleteDataset = async (id: string) => {
    await deleteDataset(id);
    load();
  };

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
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: "'IBM Plex Mono', monospace", margin: '8px 0 10px' }}>{s.detail}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(s.tables ?? []).map((t) => <Tag key={t} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{t}</Tag>)}
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
                onClick={() => { dsForm.setFieldValue('record_count', 12); setDsModal(true); }}>
                ＋ 新建数据集
              </Button>
            </div>
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
                    <Popconfirm title="删除该数据集？" okText="删除" cancelText="取消" onConfirm={() => onDeleteDataset(d.id)}>
                      <Button type="text" size="small" aria-label={`删除数据集 ${d.name}`} style={{ color: 'var(--ink-faint)' }}>×</Button>
                    </Popconfirm>
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

      {/* 新建数据源 */}
      <Modal title="新建数据源" open={srcModal} onOk={onCreateSource} onCancel={() => setSrcModal(false)} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={srcForm} layout="vertical" requiredMark={false} style={{ marginTop: 8 }}>
          <Form.Item name="name" label="数据源名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：订单 CSV 目录" />
          </Form.Item>
          <div className="panel-muted" style={{ lineHeight: 1.8 }}>
            创建后自动生成模拟订单明细（<span style={{ fontFamily: 'var(--font-mono)' }}>orders.csv</span>，含订单号/大区/城市/渠道/商品/金额/件数等字段），可在下一步基于它创建数据集。
          </div>
        </Form>
      </Modal>

      {/* 新建数据集 */}
      <Modal title="新建数据集" open={dsModal} onOk={onCreateDataset} onCancel={() => setDsModal(false)} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={dsForm} layout="vertical" requiredMark={false} style={{ marginTop: 8 }}>
          <Form.Item name="name" label="数据集名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：2026 年 9 月订单" />
          </Form.Item>
          <Form.Item name="source_ref" label="来源数据源" rules={[{ required: true, message: '请选择数据源' }]}>
            <Select placeholder="选择数据源" options={(sources ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.id}` }))} />
          </Form.Item>
          <Form.Item name="record_count" label="生成订单记录数">
            <InputNumber min={6} max={50} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}