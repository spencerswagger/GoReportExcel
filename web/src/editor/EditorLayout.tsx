import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Layout, Row, Spin } from 'antd';
import { useParams } from 'react-router-dom';
import { getDraft, renderPreview } from '../api/client';
import { useEditorStore } from '../store/editor';

export default function EditorLayout() {
  const { id } = useParams<{ id: string }>();
  const reset = useEditorStore((s) => s.reset);
  const setDraft = useEditorStore((s) => s.setDraft);
  const setRender = useEditorStore((s) => s.setRender);
  const draft = useEditorStore((s) => s.draft);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    let cancelled = false;
    setError(null);
    reset(id, 0);
    (async () => {
      try {
        const d = await getDraft(id);
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

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Alert type="error" message="加载失败" description={error} showIcon />
        <Button type="primary" style={{ marginTop: 16 }} onClick={load}>重试</Button>
      </div>
    );
  }

  if (!draft) {
    return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" tip="加载定义…" /></div>;
  }
  return (
    <Row gutter={12} style={{ height: 'calc(100vh - 120px)' }}>
      <Col span={6}>配置面板（后续任务实现）</Col>
      <Col span={13}><Layout style={{ height: '100%', background: '#fff' }}>预览画布（后续任务实现）</Layout></Col>
      <Col span={5}>检查器（后续任务实现）</Col>
    </Row>
  );
}
