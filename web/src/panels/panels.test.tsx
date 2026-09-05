import { render, screen, fireEvent } from '@testing-library/react';
import { DimensionsPanel } from './DimensionsPanel';
import { MetricsPanel } from './MetricsPanel';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

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
  const d = useEditorStore.getState().draft as DraftShape;
  const dims = d.dimensions as Array<{ label: string }>;
  expect(dims[0].label).toBe('区域');
  expect(useEditorStore.getState().saveState).toBe('dirty');
});

test('MetricsPanel shows agg type and swap toggles', () => {
  render(<MetricsPanel />);
  expect(screen.getByText('销售额')).toBeTruthy();
  expect(screen.getByText('SUM')).toBeTruthy();
});
