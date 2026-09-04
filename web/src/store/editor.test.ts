import { describe, expect, it } from 'vitest';
import { useEditorStore } from './editor';
import type { RenderSchema } from '../api/types';

const schema = { schema_version: 1, cols: [], merges: [], rows: [], styles: {} } as unknown as RenderSchema;

function fresh() {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  return useEditorStore.getState();
}

function nameOf(d: { name?: string } | null | undefined): string {
  return d && 'name' in d ? (d as { name: string }).name : '';
}

describe('editor store', () => {
  it('reset initializes draft state', () => {
    const s = fresh();
    expect(s.defId).toBe('r1');
    expect(s.baseVersion).toBe(2);
    expect(s.saveState).toBe('clean');
  });

  it('setRender caches schema and clears selection', () => {
    fresh();
    useEditorStore.getState().selectCell('r3c2');
    useEditorStore.getState().setRender(schema, 10);
    const after = useEditorStore.getState();
    expect(after.render).toBe(schema);
    expect(after.rowTotal).toBe(10);
    expect(after.selectedCell).toBeNull();
  });

  it('selectCell records cell id', () => {
    fresh();
    useEditorStore.getState().selectCell('r3c2');
    expect(useEditorStore.getState().selectedCell).toBe('r3c2');
  });

  it('marks dirty on edit and undo restores checkpoint', () => {
    const s = fresh();
    s.checkpoint('change title');
    s.mutateDraft((d) => { (d as { name?: string }).name = '新标题'; });
    expect(useEditorStore.getState().saveState).toBe('dirty');
    s.undo();
    const after = useEditorStore.getState();
    expect(after.draft && 'name' in after.draft ? after.draft.name : undefined).not.toBe('新标题');
    expect(after.saveState).toBe('dirty');
  });

  it('redo reapplies after undo', () => {
    const s = fresh();
    s.checkpoint('change title');
    s.mutateDraft((d) => { (d as { name?: string }).name = '新标题'; });
    s.undo();
    s.redo();
    const after = useEditorStore.getState();
    expect(after.draft && 'name' in after.draft ? (after.draft as { name: string }).name : '').toBe('新标题');
  });

  it('setSaveState transitions saving/conflict', () => {
    const s = fresh();
    s.setSaveState('saving');
    expect(useEditorStore.getState().saveState).toBe('saving');
    s.setSaveState('conflict');
    expect(useEditorStore.getState().saveState).toBe('conflict');
  });

  it('redo then edit then multi-step undo does not corrupt history (S1)', () => {
    const s = fresh();
    s.checkpoint('e1');
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v1'; });
    s.checkpoint('e2');
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v2'; });
    s.undo();
    s.redo();
    s.checkpoint('e3');
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v3'; });
    s.undo();
    // 第一次 undo 回到 e3 快照（v2）
    expect(nameOf(useEditorStore.getState().draft)).toBe('v2');
    s.undo();
    // 第二次 undo 应回到 redo checkpoint 的原始值 v2，而非被别名污染后的 v3
    expect(nameOf(useEditorStore.getState().draft)).toBe('v2');
  });

  it('mutateDraft creates a default draft when draft is null', () => {
    const s = fresh();
    s.mutateDraft((d) => { (d as { name?: string }).name = '默认标题'; });
    const after = useEditorStore.getState();
    expect(after.draft).not.toBeNull();
    expect(after.draft?.id).toBe('r1');
    expect(after.draft?.version).toBe(2);
    expect(nameOf(after.draft)).toBe('默认标题');
    expect(after.saveState).toBe('dirty');
  });

  it('checkpoint snapshots are isolated from later mutations', () => {
    const s = fresh();
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v1'; });
    s.checkpoint('e1');
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v2'; });
    const snap = useEditorStore.getState().undoStack[0];
    expect(nameOf(snap.draft)).toBe('v1');
    s.undo();
    expect(nameOf(useEditorStore.getState().draft)).toBe('v1');
  });

  it('mutateDraft clears the redo stack', () => {
    const s = fresh();
    s.checkpoint('e1');
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v1'; });
    s.undo();
    expect(useEditorStore.getState().redoStack.length).toBe(1);
    s.mutateDraft((d) => { (d as { name?: string }).name = 'v2'; });
    expect(useEditorStore.getState().redoStack.length).toBe(0);
  });
});
