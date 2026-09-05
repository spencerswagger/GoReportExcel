import { useEffect, useRef, useState } from 'react';
import { Button, Progress, Space, Typography } from 'antd';
import { exportDownloadUrl, exportStatus, submitExport } from '../api/client';

export function ExportButton({ defId }: { defId: string }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<string>('');
  const timer = useRef<number | null>(null);

  const stopPoll = () => {
    if (timer.current != null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const start = async () => {
    const res = await submitExport({ def_id: defId, idempotency_key: `manual-${Date.now()}` });
    setTaskId(res.task_id);
    setProgress(0);
    poll(res.task_id);
  };

  const poll = (tid: string) => {
    stopPoll();
    timer.current = window.setInterval(async () => {
      const st = await exportStatus(tid);
      setState(st.state);
      setProgress(Math.round(st.progress * 100));
      if (st.state === 'done' || st.state === 'failed') {
        stopPoll();
      }
    }, 1000);
  };

  return (
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
  );
}
