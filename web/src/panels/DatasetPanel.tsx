import { useEffect, useState } from 'react';
import { Card, Dropdown, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { fetchDatasets } from '../api/client';
import type { DatasetInfo } from '../api/types';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

export function DatasetPanel() {
  const draft = useEditorStore((s) => s.draft);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const mutateDraft = useEditorStore((s) => s.mutateDraft);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchDatasets().then((d) => { if (!cancelled) setDatasets(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const draftShape = draft as DraftShape | null;
  const currentId = (draftShape?.dataset as { id?: string } | undefined)?.id;
  const current = datasets.find((d) => d.id === currentId);

  const items: MenuProps['items'] = (datasets.length ? datasets : [
    { id: 'ds_sales', name: '销售明细' },
    { id: 'ds_employees', name: '员工花名册' },
  ]).map((d) => ({ key: d.id, label: `${d.name} · ${d.id}` }));

  const selectDataset = (id: string) => {
    if (id === currentId) return;
    const d = datasets.find((x) => x.id === id) ?? fallbackDatasets.find((x) => x.id === id);
    if (!d) return;
    checkpoint(`选择数据集 ${d.name}`);
    mutateDraft((dd) => {
      (dd as DraftShape).dataset = {
        id: d.id,
        source_ref: d.source_ref ?? 'csv_local',
        fields: d.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, sort_key: f.sort_key })),
      };
      // 切数据集后旧字段可能不存在于新集，清空维度/指标配置重新拖拽
      (dd as DraftShape).dimensions = [];
      (dd as DraftShape).metrics = [];
    });
  };

  const name = current?.name ?? current?.id ?? '未选择';

  return (
    <Card size="small" className="ate-panel" title="数据集">
      <Dropdown menu={{ items, onClick: ({ key }) => selectDataset(String(key)) }} trigger={['click']}>
        <div
          data-testid="dataset-picker"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 12px', borderRadius: 'var(--radius-s)',
            background: 'var(--paper-bg)', border: '1px solid var(--paper-line)',
            cursor: 'pointer', fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--accent-ink)' }}>▦</span>
          <Typography.Text strong style={{ color: 'var(--ink)' }}>{name}</Typography.Text>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', fontSize: 11 }}>
            {current ? `${current.field_count} 字段` : '点击选择'} ▾
          </span>
        </div>
      </Dropdown>
      {!current && (
        <div className="panel-muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
          新建报表未绑定数据集。选择数据集后，可在下方从字段池添加维度与指标。
        </div>
      )}
    </Card>
  );
}

const fallbackDatasets: Array<Pick<DatasetInfo, 'id' | 'name' | 'source_ref'> & { fields: DatasetInfo['fields'] }> = [
  {
    id: 'ds_sales', name: '销售明细', source_ref: 'csv_local',
    fields: [
      { key: 'region', type: 'string', label: '大区', sort_key: 'region_order' },
      { key: 'city', type: 'string', label: '城市' },
      { key: 'channel', type: 'string', label: '渠道' },
      { key: 'amount', type: 'number', label: '销售额' },
      { key: 'qty', type: 'number', label: '件数' },
      { key: 'cost', type: 'number', label: '成本' },
      { key: 'order_date', type: 'date', label: '下单日期' },
    ],
  },
  {
    id: 'ds_employees', name: '员工花名册', source_ref: 'csv_local',
    fields: [
      { key: 'dept', type: 'string', label: '部门' },
      { key: 'grade', type: 'string', label: '职级' },
      { key: 'headcount', type: 'number', label: '人数' },
      { key: 'salary', type: 'number', label: '薪资' },
    ],
  },
];