import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './api/mock-server';
import { resetMockStore } from './api/mock';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetMockStore());
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

// jsdom 无 canvas/ResizeObserver：S2(@antv/g) 渲染所需，提供最小 stub（全局生效）
const ctxStub = new Proxy({}, {
  get: (_t, k) => {
    // g-lite 依赖 measureText/getImageData 的返回值，缺省会因 undefined 访问崩溃
    if (k === 'canvas') return null;
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(0) });
    return () => {};
  },
}) as unknown as CanvasRenderingContext2D;
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub as unknown as RenderingContext);
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}
