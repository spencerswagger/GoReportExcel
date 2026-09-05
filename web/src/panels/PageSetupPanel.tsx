import { Card, InputNumber, Select, Space } from 'antd';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

export function PageSetupPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const print = ((draft as DraftShape | null)?.layout_opts as { print?: { orientation?: string; fit_to_width?: number; repeat_header_rows?: number } } | undefined)?.print ?? {};

  const update = (patch: Partial<{ orientation: string; fit_to_width: number; repeat_header_rows: number }>) => {
    checkpoint('编辑页面设置');
    mutateDraft((d) => {
      const def = d as DraftShape;
      const lo = (def.layout_opts ?? {}) as { print?: { orientation?: string; fit_to_width?: number; repeat_header_rows?: number } };
      def.layout_opts = { ...lo, print: { ...(lo.print ?? {}), ...patch } } as DraftShape['layout_opts'];
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
          <InputNumber min={0} max={10} value={print.fit_to_width ?? 0} onChange={(v) => update({ fit_to_width: v ?? 0 })} />
        </Space>
        <Space>
          <span>重复表头行</span>
          <InputNumber min={0} max={5} value={print.repeat_header_rows ?? 0} onChange={(v) => update({ repeat_header_rows: v ?? 0 })} />
        </Space>
      </Space>
    </Card>
  );
}
