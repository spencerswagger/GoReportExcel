import { useEffect } from 'react';
import { putDraft } from '../api/client';
import { useEditorStore } from '../store/editor';

// 300ms 防抖保存；409 → saveState='conflict'，由 UI 展示冲突横幅。
export function useAutosave(delay = 300): void {
  useEffect(() => {
    const id = setInterval(() => {
      const s = useEditorStore.getState();
      if (s.saveState !== 'dirty' || !s.draft) return;
      s.setSaveState('saving');
      putDraft(s.defId, JSON.stringify(s.draft))
        .then(() => {
          useEditorStore.getState().setSaveState('clean');
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          useEditorStore.getState().setSaveState(msg.includes('409') ? 'conflict' : 'dirty');
        });
    }, delay);
    return () => clearInterval(id);
  }, [delay]);
}
