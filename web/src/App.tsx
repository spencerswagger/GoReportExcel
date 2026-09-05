import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import ReportList from './pages/ReportList';
import EditorLayout from './editor/EditorLayout';

function AppShell() {
  return (
    <BrowserRouter>
      <header className="ate-header">
        <div className="ate-brand">
          <span className="ate-brand-mark">GoReport<em>Excel</em></span>
          <span className="ate-brand-sub">报表工坊 · REPORT ATELIER</span>
        </div>
        <nav className="ate-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>报表库</NavLink>
        </nav>
        <div className="ate-header-right">
          <span className="dot">●</span>
          <span>本地预览环境 · MSW</span>
        </div>
      </header>
      <div className="ate-body">
        <Routes>
          <Route path="/" element={<ReportList />} />
          <Route path="/editor/:id" element={<EditorLayout />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return <AppShell />;
}