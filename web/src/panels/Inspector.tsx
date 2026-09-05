import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, List, Spin, Typography } from 'antd';
import { dataTrace, patchOverride, styleExplain } from '../api/client';
import { useEditorStore } from '../store/editor';
import type { ExplainDTO } from '../api/types';

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
    <Card size="small" title="检查器">
      {!selected && <Typography.Text type="secondary">点击预览中的单元格查看详情</Typography.Text>}
      {selected && (
        <Spin spinning={loading}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="单元格">{selected}</Descriptions.Item>
            <Descriptions.Item label="类型">{stats.type ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="来源行数">{stats.count ?? '—'}</Descriptions.Item>
            {stats.formula && <Descriptions.Item label="公式"><code>{stats.formula}</code></Descriptions.Item>}
          </Descriptions>
          <Typography.Title level={5}>样式解释</Typography.Title>
          <List
            size="small" dataSource={explains}
            renderItem={(ex) => (
              <List.Item><Typography.Text strong>{ex.id}</Typography.Text>：{ex.reason}</List.Item>
            )}
          />
          <Button size="small" type="primary" style={{ marginTop: 8 }} loading={patching} onClick={applyPatch}>调整此单元格样式</Button>
          {applied && <Alert style={{ marginTop: 8 }} type="success" showIcon message="已应用（override）" />}
          {patchFailed && <Alert style={{ marginTop: 8 }} type="error" showIcon message="应用失败" />}
        </Spin>
      )}
    </Card>
  );
}
