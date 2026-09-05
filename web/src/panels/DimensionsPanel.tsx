import { useCallback } from 'react';
import { Button, Card, Input, Select, Switch, Typography } from 'antd';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

type DimRow = { field: string; label: string; sort: { by: string; dir: string } };

function SortableItem({ dim, index }: { dim: DimRow; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: dim.field });
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const checkpoint = useEditorStore((s) => s.checkpoint);

  const update = useCallback((patch: Partial<DimRow> | ((d: DimRow) => void)) => {
    checkpoint(`编辑维度 ${dim.field}`);
    mutateDraft((d) => {
      const dims = (d as DraftShape).dimensions as DimRow[];
      if (typeof patch === 'function') patch(dims[index]);
      else Object.assign(dims[index], patch);
    });
  }, [checkpoint, mutateDraft, dim.field, index]);

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}
      {...attributes} {...listeners}>
      <Typography.Text type="secondary">≣</Typography.Text>
      <Input style={{ width: 110 }} value={dim.label} onChange={(e) => update({ label: e.target.value })} />
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

  const dims = ((draft as DraftShape | null)?.dimensions ?? []) as DimRow[];

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    const from = dims.findIndex((x) => x.field === e.active.id);
    const to = dims.findIndex((x) => x.field === over.id);
    if (from < 0 || to < 0) return;
    checkpoint('调整维度顺序');
    mutateDraft((d) => {
      const arr = (d as DraftShape).dimensions as DimRow[];
      arr.splice(to, 0, arr.splice(from, 1)[0]);
    });
  };

  return (
    <Card size="small" title="维度与排序">
      <Typography.Text type="secondary" data-testid="sort-hint">排序依据：{dims[0]?.sort.by ?? '—'}</Typography.Text>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={dims.map((x) => x.field)} strategy={verticalListSortingStrategy}>
          {dims.map((dim, i) => <SortableItem key={dim.field} dim={dim} index={i} />)}
        </SortableContext>
      </DndContext>
      <Button size="small" type="dashed" block>添加维度</Button>
    </Card>
  );
}
