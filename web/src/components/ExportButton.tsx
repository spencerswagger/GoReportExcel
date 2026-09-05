import { useEffect, useRef, useState } from 'react';
import { Alert, Progress } from 'antd';
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

  const busy = progress != null && state !== 'done' && state !== 'failed';

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

  const failed = state === 'failed' || err != null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      <button type="button" className="ate-icon-btn" onClick={start} disabled={busy} aria-label="导出">
        <span className="glyph">{busy ? <span className="ate-spin-dot" style={{ fontSize: 10 }} /> : '⇩'}</span>
        {busy ? `导出 ${progress ?? 0}%` : '导出'}
      </button>
      {state === 'done' && taskId && (
        <a
          href={exportDownloadUrl(taskId)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--accent-bright)', textDecoration: 'none', borderBottom: '1px dotted rgba(200,146,62,.5)', paddingBottom: 1 }}
        >
          下载 xlsx
        </a>
      )}
      {busy && <Progress type="circle" size={16} percent={progress ?? 0} strokeColor="var(--accent)" trailColor="var(--chrome-line)" />}
      {failed && (
        <span style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20, minWidth: 220 }}>
          <Alert type="error" showIcon message={err ?? '导出失败'} />
        </span>
      )}
    </span>
  );
}