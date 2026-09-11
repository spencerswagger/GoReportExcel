import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Dropdown, MenuProps, Segmented, Spin } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getDraft, getPublished, publish, renderPreview } from '../api/client';
import { useEditorStore } from '../store/editor';
import { useAutosave } from '../hooks/useAutosave';
import { VersionDrawer } from '../components/VersionDrawer';
import { ExportButton } from '../components/ExportButton';
import { DimensionsPanel } from '../panels/DimensionsPanel';
import { MetricsPanel } from '../panels/MetricsPanel';
import { RuleBuilder } from '../panels/RuleBuilder';
import { ConditionalFormatsPanel } from '../panels/ConditionalFormatsPanel';
import { PageSetupPanel } from '../panels/PageSetupPanel';
import { Inspector } from '../panels/Inspector';
import { DatasetPanel } from '../panels/DatasetPanel';
import PreviewSheet from '../s2/PreviewSheet';
import { getPreview, setPreview, PREVIEW_HIERARCHY_TYPES, type PreviewHierarchyType } from '../s2/hierarchy';
import { applyTheme, listThemes } from '../themes';

function SaveChip({ state }: { state: string }) {
  const map: Record<string, { cls: string; label: string; spin?: boolean }> = {
    clean: { cls: 'ate-state-saved', label: '已保存' },
    dirty: { cls: 'ate-state-dirty', label: '未保存' },
    saving: { cls: 'ate-state-saving', label: '保存中', spin: true },
    conflict: { cls: 'ate-state-conflict', label: '保存冲突' },
  };
  const s = map[state] ?? map.clean;
  return (
    <span className={`ate-save-chip ${s.cls}`}>
      {s.spin ? <span className="ate-spin-dot" /> : <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}
      {s.label}
    </span>
  );
}

function ToolButton({ glyph, onClick, disabled, title, aria }: {
  glyph: string; onClick?: () => void; disabled?: boolean; title: string; aria?: string;
}) {
  return (
    <button type="button" className="ate-icon-btn" onClick={onClick} disabled={disabled} title={title} aria-label={aria ?? title}>
      <span className="glyph">{glyph}</span>
      {title}
    </button>
  );
}

export default function EditorLayout() {
  const { id } = useParams<{ id: string }>();
  const reset = useEditorStore((s) => s.reset);
  const setDraft = useEditorStore((s) => s.setDraft);
  const setRender = useEditorStore((s) => s.setRender);
  const draft = useEditorStore((s) => s.draft);
  const defId = useEditorStore((s) => s.defId);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const load = useCallback(() => {
    if (!id) return;
    let cancelled = false;
    setError(null);
    reset(id, 0);
    (async () => {
      try {
        // 优先加载草稿；无草稿时回退到已发布版本作为编辑基础。
        let d;
        try {
          d = await getDraft(id);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            d = await getPublished(id);
          } else {
            throw e;
          }
        }
        const base = d.version;
        const payload = JSON.parse(d.payload);
        if (!cancelled) setDraft({ ...payload, id }, base);
        const r = await renderPreview({ def_id: id, row_window: { from: 0, to: 50 } });
        if (!cancelled) setRender(r.schema, r.schema.report.row_total);
      } catch (e) {
        if (!cancelled) {
          reset(id, 0);
          setError(e instanceof Error ? e.message : '加载失败');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, reset, setDraft, setRender]);

  useEffect(() => load(), [load]);

  // 草稿变化后自动重新渲染预览（防抖），保证配置实时反映到画布。
  // mock 后端从草稿缓存读取配置，用户添加/删除维度指标后预览随之更新。
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      renderPreview({ def_id: defId, row_window: { from: 0, to: 50 } })
        .then((r) => { if (!cancelled) setRender(r.schema, r.schema.report.row_total); })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [defId, draft, setRender]);

  useAutosave(300);
  const saveState = useEditorStore((s) => s.saveState);
  const baseVersion = useEditorStore((s) => s.baseVersion);
  const selectedCell = useEditorStore((s) => s.selectedCell);
  const selectCell = useEditorStore((s) => s.selectCell);
  const render = useEditorStore((s) => s.render);
  const rowTotal = useEditorStore((s) => s.rowTotal);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const undoLen = useEditorStore((s) => s.undoStack.length);
  const redoLen = useEditorStore((s) => s.redoStack.length);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState(false);

  // 套用主题：checkpoint 记录撤销点后，把主题规则合并进草稿（applyTheme 已深拷贝）
  const applyThemeDraft = (themeId: string) => {
    const s = useEditorStore.getState();
    if (!s.draft) return;
    s.checkpoint(`套用主题 ${themeId}`);
    s.mutateDraft((d) => {
      const merged = applyTheme(d as unknown as Record<string, unknown>, themeId);
      Object.assign(d, merged);
    });
  };

  const themeItems: MenuProps['items'] = listThemes().map((t) => ({
    key: t.id,
    label: `套用${t.name}`,
    onClick: () => applyThemeDraft(t.id),
  }));

  // 读取草稿中的预览形态配置（默认 grid），供 Segmented 与 PreviewSheet 使用
  const previewCfg = getPreview(draft as unknown as Record<string, unknown> | null);

  const doPublish = async () => {
    setPublishError(false);
    setPublished(false);
    try {
      await publish(defId);
      setPublished(true);
    } catch {
      setPublishError(true);
    }
  };

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center', background: 'var(--paper-card)', borderRadius: 'var(--radius-m)', border: '1px solid var(--paper-line)' }}>
        <Alert type="error" message="加载失败" description={error} showIcon />
        <Button type="primary" style={{ marginTop: 16 }} onClick={load}>重试</Button>
      </div>
    );
  }

  if (!draft) {
    return (
      <div style={{ padding: 48, textAlign: 'center', background: 'var(--paper-card)', borderRadius: 'var(--radius-m)', border: '1px solid var(--paper-line)' }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: 'var(--ink-dim)', fontSize: 13 }}>正在展开报表定义…</div>
      </div>
    );
  }

  return (
    <div className="ate-editor">
      {/* 顶部工具条（深墨 chrome） */}
      <div className="ate-toolbar">
        <Link to="/" className="back-link">← 报表库</Link>
        <span className="title-sep" />
        <span className="doc-title">{draft.name}</span>
        <span className="ver-tag">v{baseVersion}</span>
        <div style={{ flex: 1 }} />
        <SaveChip state={saveState} />
        <span className="title-sep" />
        <ToolButton glyph="↩" title="撤销" disabled={undoLen === 0} onClick={undo} />
        <ToolButton glyph="↪" title="重做" disabled={redoLen === 0} onClick={redo} />
        <span className="title-sep" />
        <Dropdown menu={{ items: themeItems }} trigger={['click']} placement="bottomRight">
          <ToolButton glyph="◈" title="主题" />
        </Dropdown>
        <VersionDrawer defId={defId} />
        <ToolButton glyph="▲" title="发布" onClick={doPublish} />
        <ExportButton defId={defId} />
      </div>

      {(published || publishError || saveState === 'conflict') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {published && <Alert type="success" showIcon message="已发布" />}
          {publishError && <Alert type="error" showIcon message="发布失败" />}
          {saveState === 'conflict' && (
            <Alert type="error" showIcon message="保存冲突" description="草稿版本已过期，请刷新后重试" />
          )}
        </div>
      )}

      {/* 三栏主体 */}
      <div className="ate-editor-body">
        {/* 左：配置轨 */}
        <aside className="ate-rail" aria-label="配置面板">
          <DatasetPanel />
          <DimensionsPanel />
          <MetricsPanel />
          <RuleBuilder />
          <ConditionalFormatsPanel />
          <PageSetupPanel />
        </aside>

        {/* 中：纸张画布 */}
        <section className="ate-canvas-zone" aria-label="预览画布">
          <div className="ate-canvas-bar">
            <span style={{ letterSpacing: '.06em' }}>实时预览</span>
            <Segmented
              size="small"
              options={PREVIEW_HIERARCHY_TYPES.map((t) => ({ label: t, value: t }))}
              value={previewCfg.hierarchy_type}
              onChange={(v) => {
                const next = v as PreviewHierarchyType;
                if (next === previewCfg.hierarchy_type) return;
                const s = useEditorStore.getState();
                s.checkpoint(`切换预览形态 ${next}`);
                s.mutateDraft((d) => { setPreview(d as unknown as Record<string, unknown>, { hierarchy_type: next }); });
              }}
            />
            <span className="mono" style={{ color: 'var(--ink-faint)' }}>
              {rowTotal} ROWS · {render ? `${render.cols.length} COLS` : '—'}
            </span>
            <div style={{ flex: 1 }} />
            {selectedCell && (
              <span className="mono" style={{ color: 'var(--accent-ink)' }}>选中 {selectedCell}</span>
            )}
            <div className="ate-zoom">
              <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5}>−</button>
              <span className="val">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))} disabled={zoom >= 2}>＋</button>
            </div>
          </div>
          <div className="ate-canvas-sheet">
            <div className="ate-sheet-frame">
              {render && render.cols.length > 0 ? (
                <PreviewSheet
                  schema={render}
                  hierarchyType={previewCfg.hierarchy_type}
                  selectedCell={selectedCell}
                  onSelect={selectCell}
                  zoom={zoom}
                />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-faint)', fontFamily: "'Noto Serif SC', serif", fontSize: 15, flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 28 }}>▦</div>
                  <div>暂无预览</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', fontFamily: 'var(--font-ui)' }}>
                    请先在左侧"数据集"面板选择数据集，再拖入维度与指标
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 选中单元格后悬浮展示的样式检查器（不再占据固定右列） */}
          {selectedCell && (
            <div className="ate-inspector-float" aria-label="检查器浮层">
              <button
                type="button"
                className="ate-inspector-close"
                aria-label="关闭检查器"
                onClick={() => selectCell(null)}
              >
                ×
              </button>
              <Inspector />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}