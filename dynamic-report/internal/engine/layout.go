package engine

import "dynamic-report/internal/style"

// DetailRow is one input record fed to the GroupStack.
type DetailRow struct {
	Keys   []string
	Values map[string]any
	RowNo  int // 明细序号（1-based，数据源按读取顺序编号）
}

// SubRange is an inclusive row-index range covered by an aggregated cell.
type SubRange struct {
	FromIdx int
	ToIdx   int
}

// LayoutCell is one output cell of the materialized layout.
type LayoutCell struct {
	Value     any
	DimDepth  int
	MetricIdx int
	SubRange  SubRange
	HasRange  bool
	Formula   string
	StyleID   string
	RuleHits  []string
	Trace     *CellTrace `json:"-"`
}

// LayoutRow is one output row of the materialized layout.
type LayoutRow struct {
	Type         style.RowType
	Level        int
	GroupPath    []string
	SeqInGroup   int
	Cells        []LayoutCell
	Height       float64
	FirstOfDepth []bool
	LastOfDepth  []bool
	sheetFirst   bool // 表级首行标志（0 维度与 total 行退化用）
	sheetLast    bool // 表级末行标志（0 维度与 total 行退化用）
}

// MergeRange describes a to-be-merged span of rows at one dimension depth.
type MergeRange struct {
	DimDepth int
	FromIdx  int
	ToIdx    int
}

// Layout is the fully materialized report grid.
type Layout struct {
	Rows      []*LayoutRow
	Merges    []MergeRange
	ColWidths []float64
}

// CellTrace 描述单元格的数据来源：
// 明细行 → SourceCount=1，SampleRows=[该行 RowNo]；
// 小计/总计 → SourceCount=来源明细条数，SampleRows=前 5 条来源行号。
type CellTrace struct {
	SourceCount int   `json:"source_count"`
	SampleRows  []int `json:"sample_rows,omitempty"`
}
