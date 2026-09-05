import type { RuleJSON } from '../panels/RuleBuilder';

export interface Theme {
  id: string;
  name: string;
  rules: RuleJSON[];
  conditional_formats: Array<{ id: string; scope: { metric: string }; kind: string; color?: string; n?: number }>;
}

// 财务报告风：外粗内细边框 + 小计加粗 + 组内斑马纹 + 金额数据条
export const financeTheme: Theme = {
  id: 'finance',
  name: '财务报告风',
  rules: [
    { id: 'outer-thick', priority: 100, enabled: true,
      when: { ctx: 'row_type', op: 'in', values: ['detail', 'subtotal'] },
      style: { border: {
        top: { at: 'group_first_row', style: 'medium', else: 'hair' },
        bottom: { at: 'group_last_row', style: 'medium', else: 'hair' },
        left: { at: 'group_first_col', style: 'medium', else: 'hair' },
        right: { at: 'group_last_col', style: 'medium', else: 'hair' },
      } } },
    { id: 'zebra', priority: 50, enabled: true,
      when: { all: [
        { ctx: 'row_type', op: 'eq', value: 'detail' },
        { ctx: 'seq_in_group', mod: 2, op: 'eq', value: 0 },
      ] },
      style: { fill: { color: '#F5F7FA' } } },
    { id: 'subtotal-emphasis', priority: 120, enabled: true,
      when: { ctx: 'row_type', op: 'eq', value: 'subtotal' },
      style: { fill: { color: '#E8EEF7' }, bold: true, row_height: 22 } },
  ],
  conditional_formats: [
    { id: 'cf-amount-databar', scope: { metric: 'amount' }, kind: 'data_bar', color: '#638EC6' },
  ],
};
