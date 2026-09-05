import { useState } from 'react';
import { Alert, Button, Drawer, List, Spin, Tag, Typography } from 'antd';
import { getVersions, rollback } from '../api/client';
import type { VersionInfo } from '../api/types';

export function VersionDrawer({ defId }: { defId: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [rolled, setRolled] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setVersions(await getVersions(defId));
    } finally {
      setLoading(false);
    }
  };

  const openDrawer = () => {
    setOpen(true);
    load();
  };

  const doRollback = async (v: number) => {
    await rollback(defId, v);
    setRolled(`已回滚到 v${v}`);
    load();
  };

  return (
    <>
      <Button size="small" onClick={openDrawer}>历史版本</Button>
      <Drawer title="版本历史" width={420} open={open} onClose={() => setOpen(false)}>
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
