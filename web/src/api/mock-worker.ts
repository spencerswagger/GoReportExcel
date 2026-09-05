import { setupWorker } from 'msw/browser';
import { handlers } from './mock';

// 浏览器环境（Vite dev）使用的 MSW worker。仅 main.tsx 引用，避免测试打包引入 msw/browser。
const worker = setupWorker(...handlers);

export async function enableMocking() {
  if (import.meta.env.DEV) {
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
}
