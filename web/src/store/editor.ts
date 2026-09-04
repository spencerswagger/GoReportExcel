import { create } from 'zustand';
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

export const useEditorStore = create<EditorState>((set, get) => ({
  defId: '',
  baseVersion: 0,
  draft: null,
  saveState: 'clean',
  render: null,
  rowTotal: 0,
  selectedCell: null,
  undoStack: [],
  redoStack: [],

  reset: (defId, baseVersion) =>
    set({ defId, baseVersion, draft: null, saveState: 'clean', render: null, rowTotal: 0, selectedCell: null, undoStack: [], redoStack: [] }),

  setDraft: (draft, baseVersion) => set({ draft, baseVersion, saveState: 'clean' }),

  setRender: (schema, rowTotal) => set({ render: schema, rowTotal }),

  selectCell: (cellId) => set({ selectedCell: cellId }),

  checkpoint: (label) => {
    const { draft, baseVersion, undoStack } = get();
    undoStack.push({ label, draft: draft ? JSON.parse(JSON.stringify(draft)) : null, baseVersion });
    set({ undoStack, redoStack: [] });
  },

  mutateDraft: (fn) => {
    const { draft, defId, baseVersion } = get();
    const d = draft ?? { id: defId, version: baseVersion, name: '' };
    fn(d);
    set({ draft: { ...d }, saveState: 'dirty' });
  },

  undo: () => {
    const { undoStack, redoStack, draft, baseVersion } = get();
    const cp = undoStack.pop();
    if (!cp) return;
    redoStack.push({ label: 'redo', draft: draft ? JSON.parse(JSON.stringify(draft)) : null, baseVersion });
    set({ draft: cp.draft, baseVersion: cp.baseVersion, undoStack, redoStack, saveState: 'dirty' });
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    const cp = redoStack.pop();
    if (!cp) return;
    undoStack.push(cp);
    set({ draft: cp.draft, baseVersion: cp.baseVersion, undoStack, redoStack, saveState: 'dirty' });
  },

  setSaveState: (saveState) => set({ saveState }),
}));
