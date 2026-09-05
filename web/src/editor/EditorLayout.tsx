import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Row, Space, Spin, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { getDraft, publish, renderPreview } from '../api/client';
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
import PreviewCanvas from './PreviewCanvas';

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

  useAutosave(300);
  const saveState = useEditorStore((s) => s.saveState);
  const baseVersion = useEditorStore((s) => s.baseVersion);
  const selectedCell = useEditorStore((s) => s.selectedCell);
  const selectCell = useEditorStore((s) => s.selectCell);
  const render = useEditorStore((s) => s.render);
  const [published, setPublished] = useState(false);
  const doPublish = async () => {
    try {
      await publish(id!);
      setPublished(true);
    } catch {
      /* 保留状态 */
    }
  };

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
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Typography.Text strong>{draft.name}</Typography.Text>
          <Tag>v{baseVersion}</Tag>
          {saveState === 'saving' && <Tag color="processing">保存中</Tag>}
          {saveState === 'dirty' && <Tag color="warning">未保存</Tag>}
          {saveState === 'clean' && <Tag color="success">已保存</Tag>}
          {saveState === 'conflict' && (
            <Alert type="error" showIcon message="保存冲突" description="草稿版本已过期，请刷新后重试" />
          )}
          {published && <Tag color="success">已发布</Tag>}
        </Space>
        <Space wrap>
          <VersionDrawer defId={id!} />
          <Button size="small" type="primary" onClick={doPublish}>发布</Button>
          <ExportButton defId={id!} />
        </Space>
      </Space>
      <Row gutter={12} style={{ flex: 1, minHeight: 0 }}>
        <Col span={6} style={{ overflow: 'auto', height: '100%' }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <DimensionsPanel />
            <MetricsPanel />
            <RuleBuilder />
            <ConditionalFormatsPanel />
            <PageSetupPanel />
          </Space>
        </Col>
        <Col span={13}>
          {render ? (
            <PreviewCanvas schema={render} selectedCell={selectedCell} onSelect={selectCell} />
          ) : (
            <div style={{ padding: 48, textAlign: 'center' }}>暂无预览</div>
          )}
        </Col>
        <Col span={5}>
          <Inspector />
        </Col>
      </Row>
    </div>
  );
}
