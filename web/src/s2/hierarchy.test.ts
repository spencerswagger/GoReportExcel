import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW, getPreview, setPreview, type PreviewCfg } from './hierarchy';

describe('hierarchy preview config', () => {
  it('默认 grid', () => {
    expect(DEFAULT_PREVIEW).toEqual({ hierarchy_type: 'grid' });
    expect(getPreview(undefined)).toEqual({ hierarchy_type: 'grid' });
    expect(getPreview(null)).toEqual({ hierarchy_type: 'grid' });
  });

  it('草稿无 preview 键时回退默认', () => {
    expect(getPreview({ name: 'x' })).toEqual({ hierarchy_type: 'grid' });
  });

  it('读合法值', () => {
    expect(getPreview({ preview: { hierarchy_type: 'tree' } })).toEqual({ hierarchy_type: 'tree' });
  });

  it('非法值回退默认', () => {
    expect(getPreview({ preview: { hierarchy_type: 'sushi' } })).toEqual({ hierarchy_type: 'grid' });
  });

  it('setPreview 合并写回 draft.preview', () => {
    const d: Record<string, unknown> = { preview: { hierarchy_type: 'grid-tree' } };
    setPreview(d, { hierarchy_type: 'tree' });
    expect(d.preview).toEqual({ hierarchy_type: 'tree' });
    const d2: Record<string, unknown> = {};
    setPreview(d2, { hierarchy_type: 'grid' });
    expect(d2.preview).toEqual({ hierarchy_type: 'grid' });
  });
});