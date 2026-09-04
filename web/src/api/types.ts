export interface ColInfo {
  idx: number;
  role: 'dimension' | 'metric';
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

export interface RenderSchema {
  schema_version: number;
  report: { id: string; def_version: number; row_total: number };
  cols: ColInfo[];
  styles: Record<string, ResolvedStyle>;
  merges: MergeInfo[];
  rows: RowDTO[];
  page_setup?: PageSetupInfo;
  conditional_formats?: CFInfo[];
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
