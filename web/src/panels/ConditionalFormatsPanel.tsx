import { Button, Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

interface CFJSON {
  id: string;
  scope: { metric: string; per_group?: boolean };
  kind: string;
  color?: string;
  n?: number;
}

export function ConditionalFormatsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const cfs = ((draft as DraftShape | null)?.conditional_formats ?? []) as CFJSON[];

  const add = () => {
    checkpoint('添加条件格式');
    mutateDraft((d) => {
      const def = d as DraftShape;
      const existing = (def.conditional_formats ?? []) as CFJSON[];
      def.conditional_formats = [
        ...existing,
        { id: `cf_${existing.length + 1}`, scope: { metric: '', per_group: false }, kind: 'data_bar', color: '#638EC6' },
      ];
    });
  };

  const cols: ColumnsType<CFJSON> = [
    { title: 'ID', dataIndex: 'id' },
    { title: '类型', dataIndex: 'kind', render: (v: string) => <Tag color="green">{v}</Tag> },
    { title: '指标', dataIndex: ['scope', 'metric'], render: (v: string) => v || '—' },
    { title: '按组', dataIndex: ['scope', 'per_group'], render: (v?: boolean) => (v ? '是' : '否') },
  ];

  return (
    <Card size="small" title="条件格式" extra={<Button size="small" type="primary" onClick={add}>添加</Button>}>
      <Table<CFJSON> rowKey={(r) => r.id} size="small" pagination={false} columns={cols} dataSource={cfs} />
    </Card>
  );
}
