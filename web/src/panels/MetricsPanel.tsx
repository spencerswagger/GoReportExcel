import { useMemo } from 'react';
import { Button, Card, Dropdown, Input, Select, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { MetricDef, DimensionDef } from '../store/types';

const AGG_OPTIONS = [
  { value: 'SUM', label: '求和 SUM' },
  { value: 'AVG', label: '平均 AVG' },
  { value: 'MIN', label: '最小 MIN' },
  { value: 'MAX', label: '最大 MAX' },
  { value: 'COUNT', label: '计数 COUNT' },
];

function moveMetric(metrics: MetricDef[], from: number, to: number): MetricDef[] {
  if (from < 0 || to < 0 || from >= metrics.length || to >= metrics.length || from === to) return metrics;
  const next = [...metrics];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

/** 指标只能在数据集的数值列中选择：非数值字段无法聚合，会造成预览数值列无值 */
const isNumeric = (f: { key: string; type?: string }) => f.type === 'number' || f.type === 'boolean' || f.type === 'int';

export function MetricsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);

  const draftShape = draft as DraftShape | null;
  const metrics = Array.isArray(draftShape?.metrics) ? (draftShape.metrics as MetricDef[]) : [];
  const dims = Array.isArray(draftShape?.dimensions) ? (draftShape.dimensions as DimensionDef[]) : [];
  const datasetFields = (draftShape?.dataset as { fields?: Array<{ key: string; label?: string; type: string }> } | undefined)?.fields;

  const used = useMemo(() => new Set([...dims.map((d) => d.field), ...metrics.map((m) => m.field)]), [dims, metrics]);
  // 指标字段池：仅数值类字段
  const available = useMemo(
    () => (datasetFields ?? []).filter((f) => !used.has(f.key) && isNumeric(f)),
    [datasetFields, used],
  );
  const numericCount = useMemo(() => (datasetFields ?? []).filter((f) => isNumeric(f)).length, [datasetFields]);

  const metricItems: MenuProps['items'] = available.map((f) => ({
    key: f.key,
    label: `${f.label ?? f.key} · ${f.type}`,
  }));

  const addMetric = (field: string) => {
    const f = (datasetFields ?? []).find((x) => x.key === field);
    checkpoint(`添加指标 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      const metrics = Array.isArray(draft.metrics) ? (draft.metrics as MetricDef[]) : [];
      if (metrics.some((x) => x.field === field)) return;
      draft.metrics = [...metrics, {
        field, label: f?.label ?? field, agg: 'SUM',
        num_fmt_ref: f?.type === 'number' ? 'int' : 'int',
      }];
    });
  };

  const patchMetric = (field: string, patch: Partial<MetricDef>) => {
    checkpoint(`编辑指标 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      draft.metrics = (Array.isArray(draft.metrics) ? (draft.metrics as MetricDef[]) : [])
        .map((m) => (m.field === field ? { ...m, ...patch } : m));
    });
  };

  const removeMetric = (field: string) => {
    checkpoint(`删除指标 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      draft.metrics = (Array.isArray(draft.metrics) ? (draft.metrics as MetricDef[]) : []).filter((x) => x.field !== field);
    });
  };

  const move = (field: string, dir: -1 | 1) => {
    checkpoint(`调整指标顺序 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      const metrics = Array.isArray(draft.metrics) ? (draft.metrics as MetricDef[]) : [];
      const idx = metrics.findIndex((x) => x.field === field);
      draft.metrics = moveMetric(metrics, idx, idx + dir);
    });
  };

  const cols: ColumnsType<MetricDef> = [
    {
      title: '指标名',
      dataIndex: 'label',
      render: (v: string, r) => (
        <Input
          size="small"
          key={v}
          aria-label={`指标名 ${r.field}`}
          defaultValue={v}
          style={{ width: 68 }}
          onBlur={(e) => { if (e.target.value !== r.label) patchMetric(r.field, { label: e.target.value }); }}
        />
      ),
    },
    {
      title: '字段',
      dataIndex: 'field',
      render: (v: string) => (
        <span
          className="mono"
          title={v}
          style={{ fontSize: 11.5, color: 'var(--ink-dim)', display: 'inline-block', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}
        >{v}</span>
      ),
    },
    {
      title: '聚合',
      dataIndex: 'agg',
      width: 112,
      render: (v: string, r) => (
        <Select
          size="small"
          aria-label={`聚合方式 ${r.field}`}
          value={v}
          style={{ width: 108 }}
          options={AGG_OPTIONS}
          onChange={(agg) => patchMetric(r.field, { agg })}
        />
      ),
    },
    {
      title: '操作',
      width: 76,
      render: (_, r, i) => (
        <span style={{ display: 'inline-flex', gap: 2 }}>
          <Tooltip title="上移">
            <Button type="text" size="small" aria-label={`上移 ${r.label}`} disabled={i === 0}
              style={{ color: 'var(--ink-faint)' }} onClick={() => move(r.field, -1)}>↑</Button>
          </Tooltip>
          <Tooltip title="下移">
            <Button type="text" size="small" aria-label={`下移 ${r.label}`} disabled={i === metrics.length - 1}
              style={{ color: 'var(--ink-faint)' }} onClick={() => move(r.field, 1)}>↓</Button>
          </Tooltip>
          <Tooltip title="删除指标">
            <Button type="text" size="small" aria-label={`删除指标 ${r.label}`}
              style={{ color: 'var(--ink-faint)' }} onClick={() => removeMetric(r.field)}>×</Button>
          </Tooltip>
        </span>
      ),
    },
  ];

  return (
    <Card size="small" className="ate-panel" title="指标配置">
      <Table<MetricDef> rowKey={(r) => r.field} size="small" pagination={false} columns={cols} dataSource={metrics} />
      <Dropdown
        menu={{ items: metricItems, onClick: ({ key }) => addMetric(String(key)) }}
        trigger={['click']}
        disabled={available.length === 0}
      >
        <Button size="small" type="dashed" block disabled={available.length === 0} aria-label="添加指标">
          {available.length === 0
            ? (numericCount === 0 ? '数据集无数值列' : '数值字段已全部添加')
            : `＋ 添加指标（${available.length} 个数值列）`}
        </Button>
      </Dropdown>
    </Card>
  );
}