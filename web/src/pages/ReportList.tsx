import { Button, Typography } from 'antd';
import { Link } from 'react-router-dom';

const demoReports = [
  { id: 'rpt_sales', name: '销售报表', nameEn: 'Sales Report', version: 2, updated: '2026-09-05', metrics: 2, dims: 2, status: 'published' as const },
];

export default function ReportList() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', paddingBottom: 24 }}>
      {/* 页头：衬线标题 + 新建动作 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0, fontFamily: "'Noto Serif SC', serif", fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.01em' }}>
            报表列表
          </Typography.Title>
          <Typography.Text style={{ color: 'var(--ink-dim)', fontSize: 12, letterSpacing: '0.05em' }}>
            管理并配置动态报表定义 · DEFINITIONS
          </Typography.Text>
        </div>
        <Link to="/editor/rpt_new">
          <Button type="primary" ghost style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}>
            ＋ 新建报表
          </Button>
        </Link>
      </div>

      {/* 资产清单（纸张卡片） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {demoReports.map((r) => (
          <article
            key={r.id}
            className="ate-report-card"
            style={{
              background: 'var(--paper-card)',
              border: '1px solid var(--paper-line)',
              borderRadius: 'var(--radius-l)',
              boxShadow: 'var(--paper-shadow)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              transition: 'transform .15s var(--ease-out), box-shadow .15s var(--ease-out), border-color .15s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.transform = 'translateY(-2px)';
              el.style.borderColor = 'var(--accent)';
              el.style.boxShadow = '0 2px 4px rgba(60,48,20,.08), 0 20px 44px -14px rgba(60,48,20,.24)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.transform = 'none';
              el.style.borderColor = 'var(--paper-line)';
              el.style.boxShadow = 'var(--paper-shadow)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'Noto Serif SC', serif", fontSize: 16, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 }}>
                  {r.name}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-faint)', marginTop: 2, letterSpacing: '0.03em' }}>
                  {r.nameEn}
                </div>
              </div>
              <span className="ate-chip" style={{
                color: 'var(--ok-ink)', borderColor: 'rgba(78,138,90,.35)', background: 'rgba(78,138,90,.1)',
              }}>
                <span className="pulse-dot" /> 已发布
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { k: '版本', v: `v${r.version}` },
                { k: '维度', v: `${r.dims}` },
                { k: '指标', v: `${r.metrics}` },
              ].map((s) => (
                <div key={s.k} style={{ background: 'var(--paper-bg)', borderRadius: 'var(--radius-s)', padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.06em' }}>{s.k}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{s.v}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--paper-line)', paddingTop: 12 }}>
              <Typography.Text style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: "'IBM Plex Mono', monospace" }}>
                UPDATED {r.updated}
              </Typography.Text>
              <Link to={`/editor/${r.id}`}>
                <Button size="small" style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}>
                  进入编辑器 →
                </Button>
              </Link>
            </div>
          </article>
        ))}

        {/* 新建占位卡 */}
        <Link to="/editor/rpt_new" style={{ textDecoration: 'none' }}>
          <article
            style={{
              border: '1.5px dashed var(--paper-line)',
              borderRadius: 'var(--radius-l)',
              minHeight: 210,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: 'var(--ink-dim)',
              transition: 'border-color .15s, color .15s, background .15s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--accent)';
              el.style.color = 'var(--accent-ink)';
              el.style.background = 'rgba(200,146,62,.05)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--paper-line)';
              el.style.color = 'var(--ink-dim)';
              el.style.background = 'transparent';
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1 }}>＋</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>新建报表</div>
            <div style={{ fontSize: 12 }}>从空白定义开始配置</div>
          </article>
        </Link>
      </div>
    </div>
  );
}