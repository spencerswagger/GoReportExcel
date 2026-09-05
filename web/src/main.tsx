import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

async function bootstrap() {
  // 开发模式下动态加载 MSW mock 后端；生产构建时 import.meta.env.DEV 为 false，
  // 该分支被摇树移除，msw 不会进入产物。
  if (import.meta.env.DEV) {
    const { enableMocking } = await import('./api/mock-worker');
    await enableMocking();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN}>
        <App />
      </ConfigProvider>
    </React.StrictMode>,
  );
}

bootstrap();
