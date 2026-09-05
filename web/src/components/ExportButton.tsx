import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Progress, Space, Typography } from 'antd';
import { exportDownloadUrl, exportStatus, submitExport } from '../api/client';

export function ExportButton({ defId }: { defId: string }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const pollingRef = useRef(false);

  const stopPoll = () => {
    if (timer.current != null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => () => { cancelledRef.current = true; stopPoll(); }, []);

  const start = async () => {
    setErr(null);
    try {
      const res = await submitExport({ def_id: defId, idempotency_key: `manual-${Date.now()}` });
      if (cancelledRef.current) return;
      setTaskId(res.task_id);
      setProgress(0);
      poll(res.task_id);
    } catch (e) {
      if (cancelledRef.current) return;
      setState('failed');
      setErr(e instanceof Error ? e.message : '导出失败');
    }
  };

  const poll = (tid: string) => {
    stopPoll();
    timer.current = window.setInterval(async () => {
      // inFlight 守卫：避免响应超过 1s 时请求叠加。
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const st = await exportStatus(tid);
        if (cancelledRef.current) return;
        setState(st.state);
        setProgress(Math.round(st.progress * 100));
        if (st.state === 'done' || st.state === 'failed') {
          stopPoll();
        }
      } catch (e) {
        if (cancelledRef.current) return;
        stopPoll();
        setState('failed');
        setErr(e instanceof Error ? e.message : '导出失败');
      } finally {
        pollingRef.current = false;
      }
    }, 1000);
  };

  return (
    <Space direction="vertical" size={4}>
      <Space>
        <Button size="small" type="primary" onClick={start} loading={progress != null && state !== 'done' && state !== 'failed'}>
          导出
        </Button>
        {state === 'done' && taskId && (
          <Typography.Link href={exportDownloadUrl(taskId)} target="_blank">下载 xlsx</Typography.Link>
        )}
        {progress != null && state !== 'done' && state !== 'failed' && (
          <Progress type="circle" size={20} percent={progress} />
        )}
      </Space>
      {(state === 'failed' || err) && <Alert type="error" message={err ?? '导出失败'} />}
    </Space>
  );
}
