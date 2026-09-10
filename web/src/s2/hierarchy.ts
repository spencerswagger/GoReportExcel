export type PreviewHierarchyType = 'grid' | 'grid-tree' | 'tree';

export interface PreviewCfg {
  hierarchy_type: PreviewHierarchyType;
}

export const DEFAULT_PREVIEW: PreviewCfg = { hierarchy_type: 'grid' };

export const PREVIEW_HIERARCHY_TYPES: PreviewHierarchyType[] = ['grid', 'grid-tree', 'tree'];

function isHierarchyType(v: unknown): v is PreviewHierarchyType {
  return v === 'grid' || v === 'grid-tree' || v === 'tree';
}

// 草稿顶层键 preview（后端 Go 定义无此字段，draft 存取为原文 JSON，不消费该键）
export function getPreview(draft: Record<string, unknown> | null | undefined): PreviewCfg {
  const raw = draft?.preview as Partial<PreviewCfg> | undefined;
  if (!raw || typeof raw !== 'object' || !isHierarchyType(raw.hierarchy_type)) {
    return DEFAULT_PREVIEW;
  }
  return { hierarchy_type: raw.hierarchy_type };
}

export function setPreview(draft: Record<string, unknown>, patch: Partial<PreviewCfg>): void {
  const next: PreviewCfg = { ...getPreview(draft), ...patch };
  draft.preview = next;
}