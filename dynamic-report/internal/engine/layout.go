package engine

import "dynamic-report/internal/style"

// DetailRow is one input record fed to the GroupStack.
type DetailRow struct {
	Keys   []string
	Values map[string]any
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
	sheetFirst   bool // 0 维度时行级首行标志
	sheetLast    bool // 0 维度时行级末行标志
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
