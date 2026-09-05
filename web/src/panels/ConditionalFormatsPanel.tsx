import { Button, Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { ConditionalFormatDef } from '../store/types';

export function ConditionalFormatsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const cfs = (draft?.conditional_formats ?? []) as ConditionalFormatDef[];

  const add = () => {
    checkpoint('添加条件格式');
    mutateDraft((d) => {
      const def = d as DraftShape;
      const existing = (def.conditional_formats ?? []) as ConditionalFormatDef[];
      def.conditional_formats = [
        ...existing,
        { id: `cf_${existing.length + 1}`, scope: { metric: '', per_group: false }, kind: 'data_bar', color: '#638EC6' },
      ];
    });
  };

  const cols: ColumnsType<ConditionalFormatDef> = [
    { title: 'ID', dataIndex: 'id' },
    { title: '类型', dataIndex: 'kind', render: (v: string) => <Tag color="green">{v}</Tag> },
    { title: '指标', dataIndex: ['scope', 'metric'], render: (v: string) => v || '—' },
    { title: '按组', dataIndex: ['scope', 'per_group'], render: (v?: boolean) => (v ? '是' : '否') },
  ];

  return (
    <Card size="small" title="条件格式" extra={<Button size="small" type="primary" onClick={add}>添加</Button>}>
      <Table<ConditionalFormatDef> rowKey={(r) => r.id} size="small" pagination={false} columns={cols} dataSource={cfs} />
    </Card>
  );
}
