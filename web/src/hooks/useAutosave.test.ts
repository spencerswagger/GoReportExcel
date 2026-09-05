import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { useAutosave } from './useAutosave';
import { useEditorStore } from '../store/editor';
import { server } from '../api/mock';
import type { DraftShape } from '../store/editor';

function seed() {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  s.setDraft({ id: 'r1', version: 2, name: '销售报表' } as DraftShape, 2);
}

describe('useAutosave', () => {
  it('saves draft after debounce when dirty', async () => {
    seed();
    renderHook(() => useAutosave(150));
    act(() => {
      useEditorStore.getState().checkpoint('t');
      useEditorStore.getState().mutateDraft((d) => { d.name = '新名字'; });
    });
    await waitFor(() => {
      expect(useEditorStore.getState().saveState).toBe('clean');
    }, { timeout: 2000 });
  });

  it('stays clean without edits', async () => {
    seed();
    renderHook(() => useAutosave(100));
    await new Promise((r) => setTimeout(r, 250));
    expect(useEditorStore.getState().saveState).toBe('clean');
  });

  it('transitions to conflict on 409', async () => {
    seed();
    const s = useEditorStore.getState();
    s.setDraft({ id: 'r1', version: 1, name: '旧' } as DraftShape, 1);
    // 标记 dirty，触发自动保存；草稿 version=1 时 PUT 返回 409 → conflict
    s.checkpoint('t');
    s.mutateDraft((d) => { d.name = '新名字'; });
    renderHook(() => useAutosave(100));
    await new Promise((r) => setTimeout(r, 400));
    expect(useEditorStore.getState().saveState).toBe('conflict');
  });

  it('returns to dirty on non-409 save failure', async () => {
    seed();
    server.use(
      http.put('*/api/v1/definitions/:id/draft', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    const s = useEditorStore.getState();
    s.checkpoint('t');
    s.mutateDraft((d) => { d.name = '新名字'; });
    renderHook(() => useAutosave(100));
    await waitFor(() => {
      expect(useEditorStore.getState().saveState).toBe('dirty');
    }, { timeout: 2000 });
  });
});
