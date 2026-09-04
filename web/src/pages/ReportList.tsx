import { Button, Card, List, Typography } from 'antd';
import { Link } from 'react-router-dom';

const demoReports = [
  { id: 'rpt_sales', name: '销售报表', version: 2, updated: '2026-09-05' },
];

export default function ReportList() {
  return (
    <Card
      title="报表列表"
      extra={<Link to="/editor/rpt_new"><Button type="primary">新建报表</Button></Link>}
    >
      <List
        dataSource={demoReports}
        renderItem={(r) => (
          <List.Item
            actions={[<Link key="edit" to={`/editor/${r.id}`}>编辑</Link>]}
          >
            <Typography.Text strong>{r.name}</Typography.Text>
            <Typography.Text type="secondary">v{r.version} · 更新于 {r.updated}</Typography.Text>
          </List.Item>
        )}
      />
    </Card>
  );
}
