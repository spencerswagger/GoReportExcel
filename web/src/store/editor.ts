import { useSyncExternalStore } from 'react';
import type { RenderSchema } from '../api/types';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'conflict';

interface DraftShape {
  id: string;
  version: number;
  name: string;
  [k: string]: unknown;
}

interface Checkpoint {
  label: string;
  draft: DraftShape | null;
  baseVersion: number;
}

interface EditorState {
  defId: string;
  baseVersion: number;
  draft: DraftShape | null;
  saveState: SaveState;
  render: RenderSchema | null;
  rowTotal: number;
  selectedCell: string | null;
  undoStack: Checkpoint[];
  redoStack: Checkpoint[];

  reset(defId: string, baseVersion: number): void;
  setDraft(d: DraftShape | null, baseVersion: number): void;
  setRender(schema: RenderSchema, rowTotal: number): void;
  selectCell(cellId: string | null): void;
  checkpoint(label: string): void;
  mutateDraft(fn: (draft: DraftShape) => void): void;
  undo(): void;
  redo(): void;
  setSaveState(s: SaveState): void;
}

// 状态对象在 action 中原位更新，保证 getState() 始终返回同一引用，
// 使外部（含测试）持有的引用始终反映最新状态；通过 emit() 通知 React 订阅者重渲染。
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const state: EditorState = {
  defId: '',
  baseVersion: 0,
  draft: null,
  saveState: 'clean',
  render: null,
  rowTotal: 0,
  selectedCell: null,
  undoStack: [],
  redoStack: [],

  reset: (defId, baseVersion) => {
    Object.assign(state, {
      defId, baseVersion, draft: null, saveState: 'clean',
      render: null, rowTotal: 0, selectedCell: null, undoStack: [], redoStack: [],
    });
    emit();
  },

  setDraft: (draft, baseVersion) => {
    Object.assign(state, { draft, baseVersion, saveState: 'clean' });
    emit();
  },

  setRender: (schema, rowTotal) => {
    Object.assign(state, { render: schema, rowTotal });
    emit();
  },

  selectCell: (cellId) => {
    Object.assign(state, { selectedCell: cellId });
    emit();
  },

  checkpoint: (label) => {
    const { draft, baseVersion, undoStack } = state;
    undoStack.push({ label, draft: draft ? JSON.parse(JSON.stringify(draft)) : null, baseVersion });
    Object.assign(state, { undoStack, redoStack: [] });
    emit();
  },

  mutateDraft: (fn) => {
    const draft = state.draft ?? { id: state.defId, version: state.baseVersion, name: '' };
    fn(draft);
    Object.assign(state, { draft: { ...draft }, saveState: 'dirty' });
    emit();
  },

  undo: () => {
    const cp = state.undoStack.pop();
    if (!cp) return;
    state.redoStack.push({
      label: 'redo',
      draft: state.draft ? JSON.parse(JSON.stringify(state.draft)) : null,
      baseVersion: state.baseVersion,
    });
    Object.assign(state, { draft: cp.draft, baseVersion: cp.baseVersion, saveState: 'dirty' });
    emit();
  },

  redo: () => {
    const cp = state.redoStack.pop();
    if (!cp) return;
    state.undoStack.push(cp);
    Object.assign(state, { draft: cp.draft, baseVersion: cp.baseVersion, saveState: 'dirty' });
    emit();
  },

  setSaveState: (saveState) => {
    Object.assign(state, { saveState });
    emit();
  },
};

type Selector<T> = (s: EditorState) => T;

function useEditorStore<T>(selector: Selector<T>): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

useEditorStore.getState = () => state;
useEditorStore.subscribe = subscribe;
useEditorStore.getInitialState = () => state;

export { useEditorStore };
