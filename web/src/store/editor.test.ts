import { describe, expect, it } from 'vitest';
import { useEditorStore } from './editor';
import type { RenderSchema } from '../api/types';

const schema = { schema_version: 1, cols: [], merges: [], rows: [], styles: {} } as unknown as RenderSchema;

function fresh() {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  return useEditorStore.getState();
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
    useEditorStore.getState().setRender(schema, 10);
    const after = useEditorStore.getState();
    expect(after.render).toBe(schema);
    expect(after.rowTotal).toBe(10);
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
});
