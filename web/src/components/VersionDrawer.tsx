import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, List, Spin, Tag, Typography } from 'antd';
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
      <Button size="small" onClick={openDrawer}>历史版本</Button>
      <Drawer title="版本历史" width={420} open={open} onClose={closeDrawer}>
        {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
        {rolled && <Alert type="success" showIcon message={rolled} style={{ marginBottom: 12 }} />}
        <Spin spinning={loading}>
          <List
            dataSource={versions}
            renderItem={(v) => (
              <List.Item
                actions={[
                  <Button key="rb" size="small" onClick={() => doRollback(v.version)}>回滚</Button>,
                ]}
              >
                <Typography.Text>{`v${v.version} · ${v.status}`}</Typography.Text>
                <Tag color={v.status === 'published' ? 'blue' : 'default'}>{v.status}</Tag>
                <Typography.Text type="secondary">{v.updated_at} · {v.updated_by}</Typography.Text>
              </List.Item>
            )}
          />
        </Spin>
      </Drawer>
    </>
  );
}
