import { useEffect } from 'react';
import { Col, Layout, Row, Spin } from 'antd';
import { useParams } from 'react-router-dom';
import { getDraft, renderPreview } from '../api/client';
import { useEditorStore } from '../store/editor';

export default function EditorLayout() {
  const { id } = useParams<{ id: string }>();
  const reset = useEditorStore((s) => s.reset);
  const setDraft = useEditorStore((s) => s.setDraft);
  const setRender = useEditorStore((s) => s.setRender);
  const draft = useEditorStore((s) => s.draft);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    reset(id, 0);
    (async () => {
      try {
        const d = await getDraft(id);
        const base = d.version;
        setDraft(JSON.parse(d.payload), base);
        const r = await renderPreview({ def_id: id, row_window: { from: 0, to: 50 } });
        if (!cancelled) {
          setRender(r.schema, r.schema.report.row_total);
          setDraft({ ...JSON.parse(d.payload), id }, base);
        }
      } catch {
        reset(id, 0);
      }
    })();
    return () => { cancelled = true; };
  }, [id, reset, setDraft, setRender]);

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
