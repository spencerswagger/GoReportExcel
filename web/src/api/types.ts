export interface ColInfo {
  idx: number;
  role: 'dimension' | 'metric';
  /** 维度列的轴：row（行）或 col（列，透视列头）。缺省视为 row。 */
  axis?: 'row' | 'col';
  label: string;
  width: number;
  align: 'left' | 'right';
  num_fmt?: string;
  metric?: string; // 指标列绑定的字段名（Task 13 条件格式定位用）
}

export interface ResolvedStyle {
  BorderTop: string; BorderRight: string; BorderBottom: string; BorderLeft: string;
  Fill: string; FontColor: string; Bold: boolean; RowHeight: number; Indent: number;
}

export interface MergeInfo { r1: number; r2: number; c: number }

export interface ExplainDTO { id: string; reason: string }

export interface CellTraceDTO { source_count: number; sample_rows?: number[] }

export interface CellDTO {
  col: number;
  cell_id: string;
  value: unknown;
  display: string;
  formula?: string;
  style: string;
  rule_hits?: string[];
  explains?: ExplainDTO[];
  trace?: CellTraceDTO;
}

export interface RowDTO {
  idx: number;
  type: 'header' | 'detail' | 'subtotal' | 'total';
  group_path?: string[];
  seq?: number;
  height?: number;
  cells: CellDTO[];
  /** detail 行的列维度值：col_dim 字段 → 该行原始记录在此列的取值（S2 透视列头用） */
  col_dim_values?: Record<string, string>;
}

export interface CFStats { min: number; max: number }

export interface CFInfo {
  id: string;
  kind: 'data_bar' | 'color_scale' | 'top_n';
  color?: string;
  n?: number;
  style?: { fill?: { color: string }; bold?: boolean };
  ranges: string[];
  stats?: CFStats;
}

export interface PageSetupInfo {
  orientation?: string;
  fit_to_width?: number;
  repeat_header_rows?: number;
}

export interface ColDimensionInfo {
  field: string;
  label: string;
}

export interface RenderSchema {
  schema_version: number;
  report: { id: string; def_version: number; row_total: number };
  cols: ColInfo[];
  /** 列维度（透视为列头）字段列表；缺省表示全部维度在行向 */
  col_dims?: ColDimensionInfo[];
  styles: Record<string, ResolvedStyle>;
  merges: MergeInfo[];
  rows: RowDTO[];
  page_setup?: PageSetupInfo;
  conditional_formats?: CFInfo[];
}

export interface DataSourceInfo {
  id: string;
  name: string;
  kind: 'csv' | 'db' | 'excel';
  detail?: string;
  tables?: string[];
}

export interface DatasetFieldInfo {
  key: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  label?: string;
  sort_key?: string;
}

export interface DatasetInfo {
  id: string;
  name: string;
  source_ref: string;
  source_name?: string;
  field_count: number;
  fields: DatasetFieldInfo[];
  updated_at?: string;
}

export interface VersionInfo {
  version: number;
  status: 'draft' | 'published';
  updated_by: string;
  updated_at: string;
}

export interface TaskStatus {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  error?: string;
  artifact_path?: string;
  updated_at: string;
}

export interface ExportSubmitResult { task_id: string; def_version: number }

export interface RenderRequest {
  def_id: string;
  version?: number;
  row_window?: { from: number; to: number };
  /** 编辑器当前草稿 payload：预览始终以该配置渲染，不读后端缓存 */
  payload?: unknown;
}

export interface ExplainResult {
  cell_id: string;
  explains: ExplainDTO[];
  style: ResolvedStyle | null;
}

export interface TraceResult {
  cell_id: string;
  trace: CellTraceDTO | null;
  type: string;
  formula?: string;
}
