import { render, screen, fireEvent, act } from '@testing-library/react';
import { DimensionsPanel, reorderDims } from './DimensionsPanel';
import { MetricsPanel } from './MetricsPanel';
import { DatasetPanel } from './DatasetPanel';
import { ConditionalFormatsPanel } from './ConditionalFormatsPanel';
import { PageSetupPanel } from './PageSetupPanel';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef, MetricDef } from '../store/types';

function seededDraft(): DraftShape {
  return {
    id: 'r1', version: 2, name: '销售报表',
    dataset: {
      source_ref: 'csv_local',
      fields: [
        { key: 'region', type: 'string', sort_key: 'region_order' },
        { key: 'city', type: 'string' },
        { key: 'amount', type: 'number' },
        { key: 'qty', type: 'number' },
      ],
    },
    dimensions: [
      { field: 'region', label: '大区', sort: { by: 'sort_key', dir: 'asc' } },
      { field: 'city', label: '城市', sort: { by: 'value', dir: 'asc' } },
    ],
    metrics: [
      { field: 'amount', label: '销售额', agg: 'SUM', num_fmt_ref: 'money' },
    ],
  } as unknown as DraftShape;
}

beforeEach(() => {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  s.setDraft(seededDraft(), 2);
});

test('DimensionsPanel lists dimensions with sort direction and label', () => {
  render(<DimensionsPanel />);
  expect(screen.getByDisplayValue('大区')).toBeTruthy();
  expect(screen.getByDisplayValue('城市')).toBeTruthy();
  expect(screen.getByText(/排序依据/).textContent).toContain('sort_key');
});

test('editing dimension label mutates draft via store', () => {
  render(<DimensionsPanel />);
  const input = screen.getByDisplayValue('大区');
  fireEvent.change(input, { target: { value: '区域' } });
  fireEvent.blur(input);
  const d = useEditorStore.getState().draft as DraftShape;
  const dims = d.dimensions as Array<{ label: string }>;
  expect(dims[0].label).toBe('区域');
  expect(useEditorStore.getState().saveState).toBe('dirty');
});

test('MetricsPanel shows agg type', () => {
  render(<MetricsPanel />);
  expect(screen.getByDisplayValue('销售额')).toBeTruthy();
  // 聚合方式为可编辑的下拉，展示选项文案「求和 SUM」
  expect(screen.getByText('求和 SUM')).toBeTruthy();
});

test('undo restores dimension label after edit', () => {
  render(<DimensionsPanel />);
  const input = screen.getByDisplayValue('大区');
  fireEvent.change(input, { target: { value: '区域' } });
  fireEvent.blur(input);
  expect(((useEditorStore.getState().draft as DraftShape).dimensions as Array<{ label: string }>)[0].label).toBe('区域');
  act(() => {
    useEditorStore.getState().undo();
  });
  const dims = (useEditorStore.getState().draft as DraftShape).dimensions as Array<{ label: string }>;
  expect(dims[0].label).toBe('大区');
});

describe('reorderDims', () => {
  const dims: DimensionDef[] = [
    { field: 'a', label: 'A', sort: { by: 'sort_key', dir: 'asc' } },
    { field: 'b', label: 'B', sort: { by: 'value', dir: 'asc' } },
    { field: 'c', label: 'C', sort: { by: 'value', dir: 'desc' } },
  ];

  test('moves item forward (from < to)', () => {
    const next = reorderDims(dims, 'a', 'c');
    expect(next.map((x) => x.field)).toEqual(['b', 'c', 'a']);
  });

  test('moves item backward (from > to)', () => {
    const next = reorderDims(dims, 'c', 'a');
    expect(next.map((x) => x.field)).toEqual(['c', 'a', 'b']);
  });

  test('returns same array when activeId not found', () => {
    expect(reorderDims(dims, 'missing', 'b')).toBe(dims);
  });

  test('returns same array when over target is null (overId not found)', () => {
    expect(reorderDims(dims, 'a', 'missing')).toBe(dims);
  });

  test('returns same array when from equals to', () => {
    expect(reorderDims(dims, 'b', 'b')).toBe(dims);
  });
});

test('ConditionalFormatsPanel lists cf entries from draft', () => {
  const s = useEditorStore.getState();
  s.setDraft({
    ...seededDraft(),
    conditional_formats: [{ id: 'cf1', scope: { metric: 'amount' }, kind: 'data_bar', color: '#638EC6' }],
  } as DraftShape, 2);
  render(<ConditionalFormatsPanel />);
  expect(screen.getByText('cf1')).toBeTruthy();
  expect(screen.getByText('data_bar')).toBeTruthy();
});

test('ConditionalFormatsPanel add button appends cf entry and marks dirty', () => {
  const s = useEditorStore.getState();
  s.setDraft({
    ...seededDraft(),
    conditional_formats: [{ id: 'cf1', scope: { metric: 'amount' }, kind: 'data_bar', color: '#638EC6' }],
  } as DraftShape, 2);
  render(<ConditionalFormatsPanel />);
  fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }));
  const d = useEditorStore.getState().draft as DraftShape;
  const cfs = d.conditional_formats as Array<{ id: string }>;
  expect(cfs).toHaveLength(2);
  expect(cfs[1].id).toBe('cf_2');
  expect(screen.getByText('cf_2')).toBeTruthy();
  expect(useEditorStore.getState().saveState).toBe('dirty');
});

test('PageSetupPanel shows orientation and toggles landscape', () => {
  const s = useEditorStore.getState();
  s.setDraft(seededDraft(), 2);
  render(<PageSetupPanel />);
  expect(screen.getByText('纵向')).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(screen.getByText('横向'));
  const d = useEditorStore.getState().draft as DraftShape;
  const lo = d.layout_opts as { print?: { orientation?: string } };
  expect(lo.print?.orientation).toBe('landscape');
  expect(useEditorStore.getState().saveState).toBe('dirty');
});

test('DatasetPanel shows empty state for new report and selecting dataset seeds fields', async () => {
  const s = useEditorStore.getState();
  s.setDraft({ id: 'rpt_new', version: 2, name: '新建报表' } as DraftShape, 2);
  render(<DatasetPanel />);
  // 新建报表未绑定数据集
  expect(screen.getByText('未选择')).toBeTruthy();
  // 从下拉选择"销售明细"
  fireEvent.click(screen.getByTestId('dataset-picker'));
  const item = await screen.findByText('销售明细 · ds_sales');
  fireEvent.click(item);
  const d = useEditorStore.getState().draft as DraftShape;
  expect((d.dataset as { id?: string }).id).toBe('ds_sales');
  const fields = (d.dataset as { fields: Array<{ key: string }> }).fields;
  expect(fields.map((f) => f.key)).toContain('region');
  // 切换数据集会清空维度/指标，字段池随之可用
  expect(d.dimensions).toEqual([]);
  expect(d.metrics).toEqual([]);
  expect(screen.getByText('销售明细')).toBeTruthy();
});

function draftWithChannel(): DraftShape {
  const d = seededDraft();
  (d.dataset as { fields: Array<{ key: string; type: string }> }).fields = [
    ...(d.dataset as { fields: Array<{ key: string; type: string }> }).fields,
    { key: 'channel', type: 'string' },
  ];
  return d;
}

test('DimensionsPanel adds dimension from dataset field pool and removes it', () => {
  const s = useEditorStore.getState();
  s.setDraft(draftWithChannel(), 2);
  render(<DimensionsPanel />);
  // 从字段池添加 channel
  fireEvent.click(screen.getByRole('button', { name: /添加维度/ }));
  fireEvent.click(screen.getByText('channel · string'));
  let dims = (useEditorStore.getState().draft as DraftShape).dimensions as DimensionDef[];
  expect(dims.map((d) => d.field)).toContain('channel');
  expect(useEditorStore.getState().saveState).toBe('dirty');
  // 已占用字段不再出现在池中 → 删除 channel 后重新可用
  fireEvent.click(screen.getByLabelText('删除维度 channel'));
  dims = (useEditorStore.getState().draft as DraftShape).dimensions as DimensionDef[];
  expect(dims.map((d) => d.field)).not.toContain('channel');
});

test('MetricsPanel adds metric from numeric pool, removes and reorders it', () => {
  const s = useEditorStore.getState();
  s.setDraft(draftWithChannel(), 2);
  render(<MetricsPanel />);
  // 字符串字段不作为指标候选：字段池仅数值列（channel 是 string）
  expect(screen.queryByText('channel · string')).toBeNull();
  // 添加数值字段 qty 为第二个指标
  fireEvent.click(screen.getByRole('button', { name: /添加指标/ }));
  fireEvent.click(screen.getByText('qty · number'));
  let metrics = (useEditorStore.getState().draft as DraftShape).metrics as MetricDef[];
  expect(metrics.map((m) => m.field)).toEqual(['amount', 'qty']);
  // 上移 qty → 与 amount 换位
  fireEvent.click(screen.getByLabelText('上移 qty'));
  metrics = (useEditorStore.getState().draft as DraftShape).metrics as MetricDef[];
  expect(metrics.map((m) => m.field)).toEqual(['qty', 'amount']);
  // 删除 qty
  fireEvent.click(screen.getByLabelText('删除指标 qty'));
  metrics = (useEditorStore.getState().draft as DraftShape).metrics as MetricDef[];
  expect(metrics.map((m) => m.field)).not.toContain('qty');
});
