import { fireEvent, render, screen } from '@testing-library/react';
import { RuleBuilder } from './RuleBuilder';
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
