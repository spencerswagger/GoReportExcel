import { useEffect, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import { dataTrace, patchOverride, styleExplain } from '../api/client';
import { useEditorStore } from '../store/editor';
import type { ExplainDTO } from '../api/types';

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--chrome-line)' }}>
      <span style={{ fontSize: 11, color: 'var(--chrome-text-dim)', letterSpacing: '.05em', flexShrink: 0 }}>{k}</span>
      <span style={{
        fontSize: 12, color: 'var(--chrome-text)', textAlign: 'right', wordBreak: 'break-all',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
      }}>
        {v}
      </span>
    </div>
  );
}

export function Inspector() {
  const selected = useEditorStore((s) => s.selectedCell);
  const defId = useEditorStore((s) => s.defId);
  const [explains, setExplains] = useState<ExplainDTO[]>([]);
  const [stats, setStats] = useState<{ count?: number; formula?: string; type?: string }>({});
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [patching, setPatching] = useState(false);
  const [patchFailed, setPatchFailed] = useState(false);

  useEffect(() => {
    setApplied(false);
    if (!selected) { setExplains([]); setStats({}); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([styleExplain(selected, defId), dataTrace(selected, defId)])
      .then(([ex, tr]) => {
        if (cancelled) return;
        setExplains(ex.explains ?? []);
        setStats({ count: tr.trace?.source_count, formula: tr.formula, type: tr.type });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, defId]);

  const applyPatch = async () => {
    if (!selected) return;
    setPatching(true);
    setPatchFailed(false);
    try {
      await patchOverride(defId, 'upsert', {
        id: `ov_${selected.replace(/[^a-zA-Z0-9]/g, '_')}`,
        scope: {},
        style_patch: { fill: { color: '#FFF7E6' }, bold: true },
      });
      setApplied(true);
    } catch {
      setPatchFailed(true);
    } finally {
      setPatching(false);
    }
  };

  return (
    <section style={{
      background: 'linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,0)), var(--chrome-1)',
      border: '1px solid var(--chrome-line)',
      borderRadius: 'var(--radius-m)',
      color: 'var(--chrome-text)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      minHeight: 420,
    }}>
      {/* 检查器标题 */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--chrome-line)',
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.04em',
      }}>
        <span style={{ color: 'var(--accent-bright)' }}>◈</span>
        检查器
        {selected && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-bright)', border: '1px solid rgba(200,146,62,.4)', borderRadius: 999, padding: '1px 8px', background: 'rgba(200,146,62,.08)' }}>
            {selected}
          </span>
        )}
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 14px' }}>
        {!selected && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '56px 20px', textAlign: 'center',
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--chrome-2)', border: '1px dashed var(--chrome-line)',
              fontSize: 22, color: 'var(--accent-bright)',
            }}>
              ◎
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)' }}>点击预览中的单元格</div>
              <div style={{ fontSize: 11.5, color: 'var(--chrome-text-faint)', marginTop: 4, lineHeight: 1.7 }}>
                查看样式成因、数据血缘<br />并直接生成 override
              </div>
            </div>
          </div>
        )}

        {selected && (
          <Spin spinning={loading}>
            <div style={{ margin: '12px 0 4px', fontSize: 11, color: 'var(--chrome-text-faint)', letterSpacing: '.08em' }}>单元格属性</div>
            <Row k="类型" v={stats.type ?? '—'} />
            <Row k="来源行数" v={stats.count ?? '—'} mono />
            {stats.formula && <Row k="公式" v={<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-bright)' }}>{stats.formula}</code>} mono />}

            <div style={{ margin: '16px 0 4px', fontSize: 11, color: 'var(--chrome-text-faint)', letterSpacing: '.08em' }}>
              样式解释 · {explains.length || 0}
            </div>
            {explains.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--chrome-text-faint)', padding: '10px 0' }}>无命中规则（基础样式生效）。</div>
            )}
            {explains.map((ex) => (
              <div key={ex.id} style={{
                background: 'var(--chrome-2)', border: '1px solid var(--chrome-line)',
                borderRadius: 'var(--radius-s)', padding: '9px 11px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-bright)' }}>{ex.id}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--chrome-text-dim)', lineHeight: 1.6 }}>{ex.reason}</div>
              </div>
            ))}

            <Button
              size="small"
              loading={patching}
              onClick={applyPatch}
              style={{
                width: '100%', marginTop: 12,
                borderColor: 'var(--accent)', color: 'var(--accent-bright)',
                background: 'rgba(200,146,62,.08)',
              }}
            >
              ○ 调整此单元格样式
            </Button>
            {applied && (
              <Alert style={{ marginTop: 10 }} type="success" showIcon message="已应用（override）" />
            )}
            {patchFailed && (
              <Alert style={{ marginTop: 10 }} type="error" showIcon message="应用失败" />
            )}
          </Spin>
        )}
      </div>
    </section>
  );
}