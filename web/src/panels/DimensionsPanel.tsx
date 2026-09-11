import { useMemo } from 'react';
import { Button, Card, Dropdown, Input, Select, Switch, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef, MetricDef } from '../store/types';

export function reorderDims(dims: DimensionDef[], activeId: string, overId: string): DimensionDef[] {
  const from = dims.findIndex((x) => x.field === activeId);
  const to = dims.findIndex((x) => x.field === overId);
  if (from < 0 || to < 0 || from === to) return dims;
  const next = [...dims];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

function moveDim(dims: DimensionDef[], field: string, dir: -1 | 1): DimensionDef[] {
  const idx = dims.findIndex((x) => x.field === field);
  return reorderDims(dims, field, dims[idx + dir]?.field ?? field);
}

export function DimensionsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);

  const draftShape = draft as DraftShape | null;
  const dims = Array.isArray(draftShape?.dimensions) ? (draftShape.dimensions as DimensionDef[]) : [];
  const metrics = Array.isArray(draftShape?.metrics) ? (draftShape.metrics as MetricDef[]) : [];
  const datasetFields = (draftShape?.dataset as { fields?: Array<{ key: string; label?: string; type: string }> } | undefined)?.fields;

  // 字段池：数据集中未被维度/指标占用的字段（维度不限制类型）
  const used = useMemo(() => new Set([...dims.map((d) => d.field), ...metrics.map((m) => m.field)]), [dims, metrics]);
  const available = useMemo(
    () => (datasetFields ?? []).filter((f) => !used.has(f.key)),
    [datasetFields, used],
  );

  const dimItems: MenuProps['items'] = available.map((f) => ({
    key: f.key,
    label: `${f.label ?? f.key} · ${f.type}`,
  }));

  const addDim = (field: string) => {
    const f = (datasetFields ?? []).find((x) => x.key === field);
    checkpoint(`添加维度 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      const dims = Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : [];
      if (dims.some((x) => x.field === field)) return;
      draft.dimensions = [...dims, { field, label: f?.label ?? field, axis: 'row', sort: { by: 'sort_key', dir: 'asc' } }];
    });
  };

  const patchDim = (field: string, patch: Partial<DimensionDef>) => {
    checkpoint(`编辑维度 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      draft.dimensions = (Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : [])
        .map((x) => (x.field === field ? { ...x, ...patch } : x));
    });
  };

  const removeDim = (field: string) => {
    checkpoint(`删除维度 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      draft.dimensions = (Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : []).filter((x) => x.field !== field);
    });
  };

  const move = (field: string, dir: -1 | 1) => {
    checkpoint(`调整维度顺序 ${field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      const dims = Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : [];
      draft.dimensions = moveDim(dims, field, dir);
    });
  };

  const cols: ColumnsType<DimensionDef> = [
    {
      title: '显示名',
      dataIndex: 'label',
      render: (v: string, r) => (
        <Input
          size="small"
          key={v}
          aria-label={`显示名 ${r.field}`}
          defaultValue={v}
          style={{ width: 92 }}
          onBlur={(e) => { if (e.target.value !== r.label) patchDim(r.field, { label: e.target.value }); }}
        />
      ),
    },
    {
      title: '字段',
      dataIndex: 'field',
      render: (v: string) => <span className="mono" style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{v}</span>,
    },
    {
      title: '轴',
      dataIndex: 'axis',
      width: 64,
      render: (v: string, r) => (
        <Select
          size="small"
          aria-label={`轴 ${r.field}`}
          value={v ?? 'row'}
          style={{ width: 58 }}
          options={[
            { value: 'row', label: '行' },
            { value: 'col', label: '列' },
          ]}
          onChange={(axis) => patchDim(r.field, { axis: axis as 'row' | 'col' })}
        />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 120,
      render: (v: DimensionDef['sort'] | undefined, r) => (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Select
            size="small"
            aria-label={`排序依据 ${r.field}`}
            value={v?.by ?? 'sort_key'}
            style={{ width: 76 }}
            options={[
              { value: 'sort_key', label: 'sort_key' },
              { value: 'value', label: '值' },
            ]}
            onChange={(by) => patchDim(r.field, { sort: { by, dir: v?.dir ?? 'asc' } })}
          />
          <Switch
            size="small"
            checked={v?.dir === 'desc'}
            checkedChildren="降"
            unCheckedChildren="升"
            onChange={(dir) => patchDim(r.field, { sort: { by: v?.by ?? 'sort_key', dir: dir ? 'desc' : 'asc' } })}
          />
        </span>
      ),
    },
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
            <Button type="text" size="small" aria-label={`下移 ${r.label}`} disabled={i === dims.length - 1}
              style={{ color: 'var(--ink-faint)' }} onClick={() => move(r.field, 1)}>↓</Button>
          </Tooltip>
          <Tooltip title="删除维度">
            <Button type="text" size="small" aria-label={`删除维度 ${r.label}`}
              style={{ color: 'var(--ink-faint)' }} onClick={() => removeDim(r.field)}>×</Button>
          </Tooltip>
        </span>
      ),
    },
  ];

  const rowCount = dims.filter((d) => (d.axis ?? 'row') === 'row').length;
  const colCount = dims.length - rowCount;

  return (
    <Card size="small" className="ate-panel" title="维度配置">
      <div className="panel-muted" data-testid="sort-hint">
        排序依据：{dims[0]?.sort?.by ?? '—'} · 布局：行 {rowCount} / 列 {colCount}
      </div>
      <Table<DimensionDef> rowKey={(r) => r.field} size="small" pagination={false} columns={cols} dataSource={dims} />
      <Dropdown
        menu={{ items: dimItems, onClick: ({ key }) => addDim(String(key)) }}
        trigger={['click']}
        disabled={available.length === 0}
      >
        <Button size="small" type="dashed" block disabled={available.length === 0} aria-label="添加维度">
          {available.length === 0 ? '无可用字段' : '＋ 添加维度'}
        </Button>
      </Dropdown>
    </Card>
  );
}