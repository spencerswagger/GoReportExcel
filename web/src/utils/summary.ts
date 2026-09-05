// 条件树 → 中文自然语言摘要
export interface CondJSON {
  all?: CondJSON[];
  any?: CondJSON[];
  not?: CondJSON;
  ctx?: string;
  op?: string;
  value?: unknown;
  values?: unknown[];
  mod?: number;
}

const ctxNames: Record<string, string> = {
  row_type: '行类型',
  col_role: '列角色',
  dim_depth: '维度层级',
  seq_in_group: '组内序号',
  group_path: '分组路径',
  value: '值',
  metric_key: '指标字段',
  dim_key: '维度字段',
};

export function summarizeCondition(c: CondJSON): string {
  if (c.all) return `(${c.all.map(summarizeCondition).join(' 且 ')})`;
  if (c.any) return `(${c.any.map(summarizeCondition).join(' 或 ')})`;
  if (c.not) return `非(${summarizeCondition(c.not)})`;
  return summarizeLeaf(c);
}

function summarizeLeaf(c: CondJSON): string {
  const name = ctxNames[c.ctx ?? ''] ?? c.ctx ?? '条件';
  const base = c.mod != null ? `${name} mod ${c.mod}` : name;
  const v = JSON.stringify(c.value ?? '');
  switch (c.op) {
    case 'eq': return `${base} = ${v}`;
    case 'ne': return `${base} ≠ ${v}`;
    case 'gt': return `${base} > ${v}`;
    case 'gte': return `${base} ≥ ${v}`;
    case 'lt': return `${base} < ${v}`;
    case 'lte': return `${base} ≤ ${v}`;
    case 'in': return `${base} ∈ [${(c.values ?? []).join(', ')}]`;
    case 'prefix': return `${base} 前缀 ${(c.values ?? []).join('.')}`;
    default: return `${name} ${c.op ?? '?'} ${v}`;
  }
}
