import { useEffect, useRef } from 'react';
import { ApiError, putDraft } from '../api/client';
import { useEditorStore } from '../store/editor';

// 300ms 防抖保存；409 → saveState='conflict'，由 UI 展示冲突横幅。
export function useAutosave(delay = 300): void {
  const inFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      const s = useEditorStore.getState();
      if (s.saveState !== 'dirty' || !s.draft || inFlight.current) return;
      inFlight.current = true;
      s.setSaveState('saving');
      putDraft(s.defId, JSON.stringify(s.draft))
        .then(() => {
          // 仅当保存期间无新编辑（仍为 saving）时才置 clean，避免覆盖用户新改动。
          if (useEditorStore.getState().saveState === 'saving') {
            useEditorStore.getState().setSaveState('clean');
          }
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 409) {
            useEditorStore.getState().setSaveState('conflict');
          } else {
            useEditorStore.getState().setSaveState('dirty');
          }
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, delay);
    return () => clearInterval(id);
  }, [delay]);
}
