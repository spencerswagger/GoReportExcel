import { fireEvent, render, screen } from '@testing-library/react';
import { reorderRules, RuleBuilder, type RuleJSON } from './RuleBuilder';
import { useEditorStore } from '../store/editor';
import type { DraftShape } from '../store/editor';

function seededDraft(): DraftShape {
  return {
    id: 'r1', version: 2, name: '销售报表',
    style_rules: {
      version: 1,
      rules: [
        {
          id: 'zebra', priority: 50,
          when: { all: [{ ctx: 'row_type', op: 'eq', value: 'detail' }] },
          style: { fill: { color: '#F5F7FA' } },
        },
      ],
    },
  } as unknown as DraftShape;
}

beforeEach(() => {
  const s = useEditorStore.getState();
  s.reset('r1', 2);
  s.setDraft(seededDraft(), 2);
});

test('lists existing rules with ids and summary', () => {
  render(<RuleBuilder />);
  expect(screen.getByText('zebra')).toBeTruthy();
  expect(screen.getAllByText(/行类型 = "detail"/).length).toBeGreaterThan(0);
});

test('adds a rule card', () => {
  render(<RuleBuilder />);
  fireEvent.click(screen.getByRole('button', { name: /添加规则/ }));
  const d = useEditorStore.getState().draft as DraftShape;
  const rules = (d.style_rules as { rules: unknown[] }).rules;
  expect(rules.length).toBe(2);
});

test('toggling rule visibility persists enabled flag', () => {
  render(<RuleBuilder />);
  const switcher = screen.getAllByRole('switch')[0];
  fireEvent.click(switcher);
  const d = useEditorStore.getState().draft as DraftShape;
  const rules = (d.style_rules as { rules: Array<{ enabled?: boolean }> }).rules;
  expect(rules[0].enabled).toBe(false);
});

describe('reorderRules', () => {
  const rules: RuleJSON[] = [
    { id: 'a', priority: 10, when: {}, style: {} },
    { id: 'b', priority: 20, when: {}, style: {} },
    { id: 'c', priority: 30, when: {}, style: {} },
  ];

  test('moves item forward (from < to) and re-prioritizes', () => {
    const next = reorderRules(rules, 'a', 'c');
    expect(next.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(next.map((r) => r.priority)).toEqual([10, 20, 30]);
  });

  test('moves item backward (from > to) and re-prioritizes', () => {
    const next = reorderRules(rules, 'c', 'a');
    expect(next.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(next.map((r) => r.priority)).toEqual([10, 20, 30]);
  });

  test('returns same array reference when active id not found', () => {
    expect(reorderRules(rules, 'missing', 'b')).toBe(rules);
  });

  test('returns same array reference when over id not found', () => {
    expect(reorderRules(rules, 'a', 'missing')).toBe(rules);
  });

  test('returns same array reference when from equals to', () => {
    expect(reorderRules(rules, 'b', 'b')).toBe(rules);
  });
});
