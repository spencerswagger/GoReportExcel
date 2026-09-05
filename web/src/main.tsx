import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '@fontsource/noto-serif-sc/chinese-simplified-400.css';
import '@fontsource/noto-serif-sc/chinese-simplified-600.css';
import '@fontsource/noto-serif-sc/chinese-simplified-700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './index.css';
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
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: '#C8923E',
            colorInfo: '#4A6D8C',
            colorSuccess: '#4E8A5A',
            colorWarning: '#C8923E',
            colorError: '#B4543C',
            colorText: '#2B2619',
            colorTextSecondary: '#70674F',
            colorBgLayout: '#F2EDE2',
            colorBgContainer: '#FFFFFF',
            colorBorder: '#E2DAC8',
            borderRadius: 6,
            fontFamily: "'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
            fontSize: 13,
          },
          components: {
            Card: { headerBg: 'transparent' },
            Table: { headerBg: '#F7F3EA', headerColor: '#70674F' },
          },
        }}
      >
        <App />
      </ConfigProvider>
    </React.StrictMode>,
  );
}

bootstrap();