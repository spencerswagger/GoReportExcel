import { financeTheme, type Theme } from './finance';
import { compactTheme } from './compact';

const registry: Theme[] = [financeTheme, compactTheme];

export function listThemes(): Theme[] {
  return registry;
}

export function getTheme(id: string): Theme {
  const t = registry.find((x) => x.id === id);
  if (!t) throw new Error(`theme ${id} not found`);
  return t;
}

// applyTheme 把主题规则合并进草稿定义（覆盖 style_rules 与 conditional_formats）。
export function applyTheme(draft: Record<string, unknown>, id: string): Record<string, unknown> {
  const t = getTheme(id);
  return {
    ...draft,
    style_rules: { version: 1, rules: t.rules },
    conditional_formats: t.conditional_formats,
  };
}
