import { Layout } from 'antd';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ReportList from './pages/ReportList';
import EditorLayout from './editor/EditorLayout';

export default function App() {
  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Header style={{ color: '#fff' }}>GoReportExcel 报表管理端</Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/" element={<ReportList />} />
            <Route path="/editor/:id" element={<EditorLayout />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </BrowserRouter>
  );
}
