import { useEffect, useRef, useState } from 'react';
import { Alert, Drawer, List, Spin } from 'antd';
import { getVersions, rollback } from '../api/client';
import type { VersionInfo } from '../api/types';

export function VersionDrawer({ defId }: { defId: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [rolled, setRolled] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // 组件卸载后不再更新状态。
  useEffect(() => {
    return () => { cancelledRef.current = true; };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const vs = await getVersions(defId);
      if (!cancelledRef.current) {
        setVersions(vs);
        setErr(null);
      }
    } catch (e) {
      if (!cancelledRef.current) {
        setErr(e instanceof Error ? e.message : '加载版本历史失败');
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  const openDrawer = () => {
    cancelledRef.current = false;
    setErr(null);
    setOpen(true);
    load();
  };

  const closeDrawer = () => {
    cancelledRef.current = true;
    setOpen(false);
  };

  const doRollback = async (v: number) => {
    try {
      await rollback(defId, v);
      setRolled(`已回滚到 v${v}`);
      load();
    } catch {
      setErr('回滚失败');
    }
  };

  return (
    <>
      <button type="button" className="ate-icon-btn" onClick={openDrawer} aria-label="历史版本">
        <span className="glyph">◬</span>
        历史版本
      </button>
      <Drawer
        title={<span style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 600 }}>版本历史</span>}
        width={420}
        open={open}
        onClose={closeDrawer}
        styles={{ body: { background: 'var(--paper-bg)' } }}
      >
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
        {rolled && <Alert type="success" showIcon message={rolled} style={{ marginBottom: 12 }} />}
        <Spin spinning={loading}>
          <List
            dataSource={versions}
            renderItem={(v) => (
              <List.Item
                actions={[
                  <button key="rb" type="button" className="ate-btn sm" onClick={() => doRollback(v.version)}>
                    回滚
                  </button>,
                ]}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                    v{v.version}
                    <span
                      style={{
                        marginLeft: 8, fontSize: 10, letterSpacing: '.06em', padding: '1px 7px', borderRadius: 999,
                        color: v.status === 'published' ? 'var(--ok-ink)' : 'var(--ink-dim)',
                        background: v.status === 'published' ? 'rgba(78,138,90,.12)' : 'var(--paper-bg)',
                        border: `1px solid ${v.status === 'published' ? 'rgba(78,138,90,.35)' : 'var(--paper-line)'}`,
                      }}
                    >
                      {v.status}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
                    {v.updated_at} · {v.updated_by}
                  </span>
                </div>
              </List.Item>
            )}
          />
        </Spin>
      </Drawer>
    </>
  );
}