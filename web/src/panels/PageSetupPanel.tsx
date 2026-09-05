import { useState } from 'react';
import { Card, InputNumber, Select, Space } from 'antd';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { PageSetupInfo } from '../api/types';

function NumberField({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState<number | null>(null);
  return (
    <InputNumber
      min={min}
      max={max}
      value={local ?? value}
      onChange={(v) => setLocal(v)}
      onBlur={() => {
        const next = local ?? value;
        if (next !== value) onCommit(next);
        setLocal(null);
      }}
    />
  );
}

export function PageSetupPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const print = (draft?.layout_opts as { print?: PageSetupInfo } | undefined)?.print ?? {};

  const update = (patch: Partial<PageSetupInfo>) => {
    const changed = (Object.keys(patch) as (keyof PageSetupInfo)[]).some((k) => patch[k] !== print[k]);
    if (!changed) return;
    checkpoint('编辑页面设置');
    mutateDraft((d) => {
      const def = d as DraftShape;
      const lo = (def.layout_opts ?? {}) as { print?: PageSetupInfo };
      def.layout_opts = { ...lo, print: { ...(lo.print ?? {}), ...patch } };
    });
  };

  return (
    <Card size="small" title="页面设置">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <span>方向</span>
          <Select style={{ width: 120 }} value={print.orientation ?? 'portrait'} onChange={(v) => update({ orientation: v })} options={[
            { value: 'portrait', label: '纵向' },
            { value: 'landscape', label: '横向' },
          ]} />
        </Space>
        <Space>
          <span>缩放至一页宽</span>
          <NumberField value={print.fit_to_width ?? 0} min={0} max={10} onCommit={(v) => update({ fit_to_width: v })} />
        </Space>
        <Space>
          <span>重复表头行</span>
          <NumberField value={print.repeat_header_rows ?? 0} min={0} max={5} onCommit={(v) => update({ repeat_header_rows: v })} />
        </Space>
      </Space>
    </Card>
  );
}
