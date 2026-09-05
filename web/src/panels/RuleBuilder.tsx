import { useCallback } from 'react';
import { Button, Card, Input, Space, Switch, Typography } from 'antd';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import { summarizeCondition, type CondJSON } from '../utils/summary';

export interface RuleJSON {
  id: string;
  priority: number;
  enabled?: boolean;
  when: CondJSON;
  style: { fill?: { color?: string }; font_color?: string; bold?: boolean; row_height?: number; border?: unknown };
}

type RulesContainer = { version: number; rules: RuleJSON[] };

function getRules(d: DraftShape | null): RuleJSON[] {
  return ((d?.style_rules as RulesContainer | undefined)?.rules ?? []);
}

function RuleCard({ rule, index }: { rule: RuleJSON; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: rule.id });
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);

  const patch = useCallback((fn: (r: RuleJSON) => void) => {
    checkpoint(`编辑规则 ${rule.id}`);
    mutateDraft((d) => {
      const container = (d as DraftShape).style_rules as RulesContainer | undefined;
      const rules = container?.rules ?? [];
      if (index >= rules.length) return;
      const next = [...rules];
      next[index] = { ...next[index], style: { ...next[index].style } };
      fn(next[index]);
      (d as DraftShape).style_rules = { version: container?.version ?? 1, rules: next };
    });
  }, [checkpoint, mutateDraft, rule.id, index]);

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, border: '1px solid #eee', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={4}>
          <span {...attributes} {...listeners} style={{ cursor: 'grab', display: 'inline-flex' }}>
            <Typography.Text type="secondary">≣</Typography.Text>
          </span>
          <Typography.Text strong>{rule.id}</Typography.Text>
        </Space>
        <Switch size="small" defaultChecked={rule.enabled !== false}
          onChange={(v) => patch((r) => { r.enabled = v; })} />
      </Space>
      <Typography.Text type="secondary" style={{ display: 'block', margin: '4px 0' }}>
        {summarizeCondition(rule.when)}
      </Typography.Text>
      <Space size={4}>
        <Input type="color" defaultValue={rule.style.fill?.color ?? '#FFFFFF'} style={{ width: 40, padding: 0 }}
          onChange={(e) => patch((r) => { r.style.fill = { color: e.target.value }; })} />
        <Typography.Text type="secondary">底色</Typography.Text>
      </Space>
    </div>
  );
}

export function RuleBuilder() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const rules = getRules(draft);

  const addRule = () => {
    checkpoint('添加规则');
    mutateDraft((d) => {
      const container = (d as DraftShape).style_rules as RulesContainer | undefined;
      const existing = container?.rules ?? [];
      const next = [
        ...existing,
        {
          id: `rule_${existing.length + 1}`, priority: 10 * (existing.length + 1),
          enabled: true, when: { ctx: 'row_type', op: 'eq', value: 'detail' },
          style: {},
        },
      ];
      (d as DraftShape).style_rules = { version: container?.version ?? 1, rules: next };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    const from = rules.findIndex((x) => x.id === e.active.id);
    const to = rules.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    checkpoint('调整规则顺序');
    mutateDraft((d) => {
      const container = (d as DraftShape).style_rules as RulesContainer | undefined;
      const arr = container?.rules ?? [];
      const moved = arrayMove(arr, from, to).map((r, i) => ({ ...r, priority: 10 * (i + 1) }));
      (d as DraftShape).style_rules = { version: container?.version ?? 1, rules: moved };
    });
  };

  return (
    <Card size="small" title="样式规则（图层）"
      extra={<Button size="small" type="primary" onClick={addRule}>添加规则</Button>}>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {rules.map((r, i) => <RuleCard key={r.id} rule={r} index={i} />)}
        </SortableContext>
      </DndContext>
    </Card>
  );
}
