import { Layout } from 'antd';

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ color: '#fff' }}>GoReportExcel 报表管理端</Layout.Header>
      <Layout.Content style={{ padding: 24 }}>报表列表</Layout.Content>
    </Layout>
  );
}
