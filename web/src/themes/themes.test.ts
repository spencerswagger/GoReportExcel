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
    expect(t.conditional_formats.length).toBeGreaterThanOrEqual(0);
  });

  it('applyTheme merges rules into a definition draft', () => {
    const draft = { id: 'r1', version: 2, name: 'x', style_rules: { version: 1, rules: [] }, conditional_formats: [] } as unknown as Record<string, unknown>;
    const out = applyTheme(draft, 'finance');
    expect((out.style_rules as { rules: unknown[] }).rules.length).toBeGreaterThan(0);
  });
});
