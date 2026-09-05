import { financeTheme as base, type Theme } from './finance';

export const compactTheme: Theme = {
  ...base,
  id: 'compact',
  name: '数据密集型',
  rules: [
    { id: 'thin-grid', priority: 10, enabled: true,
      when: { ctx: 'row_type', op: 'in', values: ['detail', 'subtotal', 'total'] },
      style: { border: {
        top: { style: 'thin' }, left: { style: 'thin' },
        right: { style: 'thin' }, bottom: { style: 'thin' },
      }, row_height: 16 } },
    { id: 'total-emphasis', priority: 100, enabled: true,
      when: { ctx: 'row_type', op: 'eq', value: 'total' },
      style: { bold: true, fill: { color: '#F0F4FF' } } },
  ],
  conditional_formats: [
    { id: 'cf-amount-scale', scope: { metric: 'amount' }, kind: 'color_scale', color: '#638EC6' },
  ],
};
