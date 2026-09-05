import { useCallback } from 'react';
import { Button, Card, Input, Select, Switch, Typography } from 'antd';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef } from '../store/types';

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

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <span {...attributes} {...listeners} style={{ cursor: 'grab', display: 'inline-flex' }}>
        <Typography.Text type="secondary">≣</Typography.Text>
      </span>
      <Input style={{ width: 110 }} defaultValue={dim.label} onBlur={(e) => {
        if (e.target.value !== dim.label) update({ label: e.target.value });
      }} />
      <Select style={{ width: 90 }} value={dim.sort.by} onChange={(v) => update({ sort: { by: v, dir: dim.sort.dir } })} options={[
        { value: 'sort_key', label: 'sort_key' },
        { value: 'value', label: '值' },
      ]} />
      <Switch checked={dim.sort.dir === 'desc'} checkedChildren="降" unCheckedChildren="升"
        onChange={(v) => update({ sort: { by: dim.sort.by, dir: v ? 'desc' : 'asc' } })} />
    </div>
  );
}

export function DimensionsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dims = Array.isArray((draft as DraftShape | null)?.dimensions) ? ((draft as DraftShape).dimensions as DimensionDef[]) : [];

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

  return (
    <Card size="small" className="ate-panel" title="维度与排序">
      <div className="panel-muted" data-testid="sort-hint">排序依据：{dims[0]?.sort.by ?? '—'}</div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={dims.map((x) => x.field)} strategy={verticalListSortingStrategy}>
          {dims.map((dim, i) => <SortableItem key={dim.field} dim={dim} index={i} />)}
        </SortableContext>
      </DndContext>
      <Button size="small" type="dashed" block>添加维度</Button>
    </Card>
  );
}
