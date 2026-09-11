import { useCallback, useMemo } from 'react';
import { Button, Card, Dropdown, Input, Select, Switch, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef, MetricDef } from '../store/types';

export function reorderDims(dims: DimensionDef[], activeId: string, overId: string): DimensionDef[] {
  const from = dims.findIndex((x) => x.field === activeId);
  const to = dims.findIndex((x) => x.field === overId);
  if (from < 0 || to < 0 || from === to) return dims;
  return arrayMove(dims, from, to);
}

function SortableItem({ dim, index }: { dim: DimensionDef; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: dim.field });
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const checkpoint = useEditorStore((s) => s.checkpoint);

  const update = useCallback((patch: Partial<DimensionDef>) => {
    checkpoint(`编辑维度 ${dim.field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      const dims = Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : [];
      if (index >= dims.length) return;
      const next = [...dims];
      next[index] = { ...next[index], ...patch };
      draft.dimensions = next;
    });
  }, [checkpoint, mutateDraft, dim.field, index]);

  const remove = useCallback(() => {
    checkpoint(`删除维度 ${dim.field}`);
    mutateDraft((d) => {
      const draft = d as DraftShape;
      draft.dimensions = (Array.isArray(draft.dimensions) ? (draft.dimensions as DimensionDef[]) : []).filter((x) => x.field !== dim.field);
    });
  }, [checkpoint, mutateDraft, dim.field]);

  const axis = dim.axis ?? 'row';

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, marginBottom: 8, borderRadius: 'var(--radius-s)', border: '1px solid var(--paper-line)', padding: '6px 8px' }}>
      {/* 第一行：字段名 + 行/列轴 + 删除 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span {...attributes} {...listeners} style={{ cursor: 'grab', display: 'inline-flex', flexShrink: 0 }}>
          <Typography.Text type="secondary">≣</Typography.Text>
        </span>
        <span className="mono" data-testid={`dim-field-${dim.field}`} style={{ fontSize: 11, color: 'var(--ink-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dim.field}
        </span>
        <Select size="small" aria-label={`轴 ${dim.field}`} value={axis} style={{ width: 62 }} options={[
          { value: 'row', label: '行' },
          { value: 'col', label: '列' },
        ]} onChange={(v) => update({ axis: v })} />
        <Tooltip title="删除维度">
          <Button type="text" size="small" aria-label={`删除维度 ${dim.field}`} style={{ color: 'var(--ink-faint)' }}
            onClick={remove}>×</Button>
        </Tooltip>
      </div>
      {/* 第二行：显示名 + 排序依据 + 升降序 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Input size="small" key={dim.label} style={{ width: 96 }} defaultValue={dim.label} aria-label={`显示名 ${dim.field}`} onBlur={(e) => {
          if (e.target.value !== dim.label) update({ label: e.target.value });
        }} />
        <Select size="small" style={{ width: 78 }} value={dim.sort?.by ?? 'sort_key'} onChange={(v) => update({ sort: { by: v, dir: dim.sort?.dir ?? 'asc' } })} options={[
          { value: 'sort_key', label: 'sort_key' },
          { value: 'value', label: '值' },
        ]} />
        <Switch checked={dim.sort?.dir === 'desc'} checkedChildren="降" unCheckedChildren="升"
          onChange={(v) => update({ sort: { by: dim.sort?.by ?? 'sort_key', dir: v ? 'desc' : 'asc' } })} />
      </div>
    </div>
  );
}

export function DimensionsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dims = Array.isArray((draft as DraftShape | null)?.dimensions) ? ((draft as DraftShape).dimensions as DimensionDef[]) : [];
  const metrics = Array.isArray((draft as DraftShape | null)?.metrics) ? ((draft as DraftShape).metrics as MetricDef[]) : [];
  const datasetFields = ((draft as DraftShape | null)?.dataset as { fields?: Array<{ key: string; label?: string; type: string }> } | undefined)?.fields;

  // 字段池：数据集中未被维度/指标占用的字段
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

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    const next = reorderDims(dims, String(e.active.id), String(over.id));
    if (next === dims) return;
    checkpoint('调整维度顺序');
    mutateDraft((d) => {
      (d as DraftShape).dimensions = next;
    });
  };

  const rowCount = dims.filter((d) => (d.axis ?? 'row') === 'row').length;
  const colCount = dims.length - rowCount;

  return (
    <Card size="small" className="ate-panel" title="维度与排序">
      <div className="panel-muted" data-testid="sort-hint">
        排序依据：{dims[0]?.sort?.by ?? '—'} · 布局：行 {rowCount} / 列 {colCount}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={dims.map((x) => x.field)} strategy={verticalListSortingStrategy}>
          {dims.map((dim, i) => <SortableItem key={dim.field} dim={dim} index={i} />)}
        </SortableContext>
      </DndContext>
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