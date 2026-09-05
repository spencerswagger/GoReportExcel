import { setupServer } from 'msw/node';
import { handlers } from './mock';

// Node 环境（Vitest）使用的 MSW server。仅测试代码引用，避免浏览器打包引入 msw/node。
export const server = setupServer(...handlers);
