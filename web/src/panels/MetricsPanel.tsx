import { Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { MetricDef } from '../store/types';

export function MetricsPanel() {
  const draft = useEditorStore((s) => s.draft);
  const metrics = Array.isArray((draft as DraftShape | null)?.metrics) ? ((draft as DraftShape).metrics as MetricDef[]) : [];
  const cols: ColumnsType<MetricDef> = [
    { title: '指标', dataIndex: 'label' },
    { title: '字段', dataIndex: 'field' },
    { title: '聚合', dataIndex: 'agg', render: (v: string) => <Tag color="blue">{v}</Tag> },
  ];
  return (
    <Card size="small" title="指标配置">
      <Table<MetricDef> rowKey={(r) => r.field} size="small" pagination={false} columns={cols} dataSource={metrics} />
    </Card>
  );
}
