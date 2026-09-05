export interface SortSpec { by: string; dir: string }
export interface DimensionDef { field: string; label: string; sort: SortSpec }
export interface MetricDef { field: string; label: string; agg: string; num_fmt_ref?: string }
export interface DatasetField { key: string; type: string; sort_key?: string }
export interface DatasetSpec { source_ref: string; fields: DatasetField[] }

export interface ConditionalFormatDef {
  id: string;
  scope: { metric: string; per_group?: boolean };
  kind: string;
  color?: string;
  n?: number;
}
