import { render, screen, fireEvent, act } from '@testing-library/react';
import { DimensionsPanel, reorderDims } from './DimensionsPanel';
import { MetricsPanel } from './MetricsPanel';
import { ConditionalFormatsPanel } from './ConditionalFormatsPanel';
import { PageSetupPanel } from './PageSetupPanel';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';
import type { DimensionDef } from '../store/types';

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
  expect(screen.getByText('销售额')).toBeTruthy();
  expect(screen.getByText('SUM')).toBeTruthy();
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
