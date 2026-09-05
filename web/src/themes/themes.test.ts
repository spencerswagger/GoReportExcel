import { describe, expect, it } from 'vitest';
import { getTheme, listThemes, applyTheme } from './index';

describe('themes', () => {
  it('lists built-in themes', () => {
    const names = listThemes().map((t) => t.id);
    expect(names).toContain('finance');
    expect(names).toContain('compact');
  });

  it('finance theme carries rules and conditional formats', () => {
    const t = getTheme('finance');
    expect(t.rules.length).toBeGreaterThan(0);
    expect(t.conditional_formats.length).toBeGreaterThan(0);
  });

  it('applyTheme merges rules into a definition draft without polluting the registry', () => {
    const draft = { id: 'r1', version: 2, name: 'x', style_rules: { version: 1, rules: [] }, conditional_formats: [] } as unknown as Record<string, unknown>;
    const out = applyTheme(draft, 'finance');
    // draft 原有字段保留
    expect(out.name).toBe('x');
    // rules 与 conditional_formats 被合并
    expect((out.style_rules as { rules: unknown[] }).rules.length).toBeGreaterThan(0);
    expect((out.conditional_formats as unknown[]).length).toBeGreaterThan(0);
    // 不可变性：修改 applyTheme 输出不会污染主题注册表
    const firstRules = (out.style_rules as { rules: Array<{ id: string; style: Record<string, unknown> }> }).rules;
    firstRules[0].style = { fill: { color: '#000000' } };
    const again = applyTheme(draft, 'finance');
    const againRules = (again.style_rules as { rules: Array<{ id: string; style: Record<string, unknown> }> }).rules;
    expect(againRules[0].style).not.toEqual(firstRules[0].style);
  });
});
