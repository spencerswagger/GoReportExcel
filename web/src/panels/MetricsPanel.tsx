import { useMemo } from 'react';
import { Button, Card, Dropdown, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef, MetricDef } from '../store/types';

function moveMetric(metrics: MetricDef[], from: number, to: number): MetricDef[] {
  if (from < 0 || to < 0 || from >= metrics.length || to >= metrics.length || from === to) return metrics;
  const next = [...metrics];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

export function moveMetrics(metrics: MetricDef[], field: string, dir: -1 | 1): MetricDef[] {
  const idx = metrics.findIndex((x) => x.field === field);
  return moveMetric(metrics, idx, idx + dir);
}

export function MetricsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);

  const draftShape = draft as DraftShape | null;
  const metrics = Array.isArray(draftShape?.metrics) ? (draftShape.metrics as MetricDef[]) : [];
  const dims = Array.isArray(draftShape?.dimensions) ? (draftShape.dimensions as DimensionDef[]) : [];
  const datasetFields = (draftShape?.dataset as { fields?: Array<{ key: string; label?: string; type: string }> } | undefined)?.fields;

  const used = useMemo(() => new Set([...dims.map((d) => d.field), ...metrics.map((m) => m.field)]), [dims, metrics]);
  const available = useMemo(
    () => (datasetFields ?? []).filter((f) => !used.has(f.key)),
    [datasetFields, used],
  );

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
      draft.metrics = [...metrics, { field, label: f?.label ?? field, agg: 'SUM', num_fmt_ref: f?.type === 'number' ? 'int' : 'int' }];
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
      draft.metrics = moveMetric(metrics, metrics.findIndex((x) => x.field === field), metrics.findIndex((x) => x.field === field) + dir);
    });
  };

  const cols: ColumnsType<MetricDef> = [
    { title: '指标', dataIndex: 'label' },
    { title: '字段', dataIndex: 'field' },
    { title: '聚合', dataIndex: 'agg', render: (v: string) => <Tag color="blue">{v}</Tag> },
    {
      title: '操作',
      width: 96,
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
          {available.length === 0 ? '无可用字段' : '＋ 添加指标'}
        </Button>
      </Dropdown>
    </Card>
  );
}