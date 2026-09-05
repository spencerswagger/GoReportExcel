import { Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

type MetricRow = { field: string; label: string; agg: string };

export function MetricsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const metrics = ((draft as DraftShape | null)?.metrics ?? []) as MetricRow[];
  const cols: ColumnsType<MetricRow> = [
    { title: '指标', dataIndex: 'label' },
    { title: '字段', dataIndex: 'field' },
    { title: '聚合', dataIndex: 'agg', render: (v: string) => <Tag color="blue">{v}</Tag> },
  ];
  return (
    <Card size="small" title="指标配置">
      <Table<MetricRow> rowKey={(r) => r.field} size="small" pagination={false} columns={cols} dataSource={metrics} />
    </Card>
  );
}
