package engine

import (
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// GroupStack incrementally materializes the grouped report layout while
// feeding detail rows. It keeps one groupState per open dimension level plus
// a root aggregator for the grand total.
type GroupStack struct {
	def             *model.ReportDefinition
	Layout          *Layout
	stack           []*groupState
	root            []*Aggregator
	seq             int
	rootDetailCount int
	rootSamples     []int
}

// groupState tracks one open group at a dimension depth.
type groupState struct {
	depth            int
	key              string
	startIdx         int
	aggs             []*Aggregator
	firstDetailRowNo int
	detailCount      int
	detailSamples    []int // 抽样不超过 5 条 RowNo
}

// NewGroupStack creates an empty GroupStack for the given definition.
func NewGroupStack(def *model.ReportDefinition) *GroupStack {
	return &GroupStack{
		def:    def,
		Layout: &Layout{},
		root:   newAggs(def.Metrics),
	}
}

func newAggs(metrics []model.MetricDef) []*Aggregator {
	aggs := make([]*Aggregator, len(metrics))
	for i, m := range metrics {
		aggs[i] = NewAggregator(m.Agg)
	}
	return aggs
}

// Feed folds one detail row into the layout.
func (g *GroupStack) Feed(r DetailRow) {
	keys := r.Keys

	lcp := 0
	for lcp < len(g.stack) && lcp < len(keys) && g.stack[lcp].key == keys[lcp] {
		lcp++
	}
	for len(g.stack) > lcp {
		g.closeTop()
	}

	// Open new groups from the deepest common prefix down to the leaf level.
	for d := lcp; d < len(keys); d++ {
		g.stack = append(g.stack, &groupState{
			depth:    d,
			key:      keys[d],
			startIdx: len(g.Layout.Rows),
			aggs:     newAggs(g.def.Metrics),
		})
		if d == len(keys)-1 {
			g.seq = 0
		}
	}

	// With no dimensions the seq is the number of already emitted details.
	if len(keys) == 0 {
		g.seq = len(g.Layout.Rows)
	}
	g.seq++

	for _, gs := range g.stack {
		gs.detailCount++
		if len(gs.detailSamples) < 5 {
			gs.detailSamples = append(gs.detailSamples, r.RowNo)
		}
	}
	if len(g.root) > 0 {
		g.rootDetailCount++
		if len(g.rootSamples) < 5 {
			g.rootSamples = append(g.rootSamples, r.RowNo)
		}
	}

	row := g.detailRow(r)
	row.Cells = g.attachDetailTrace(row.Cells, r.RowNo)
	row.SeqInGroup = g.seq
	g.Layout.Rows = append(g.Layout.Rows, row)
}

// detailRow builds one detail row and folds its metrics into all open groups
// and the root. Groups are opened before this call so their aggregators exist.
func (g *GroupStack) detailRow(r DetailRow) *LayoutRow {
	row := &LayoutRow{
		Type:      style.RowDetail,
		GroupPath: append([]string(nil), r.Keys...),
	}
	for d := range g.def.Dimensions {
		row.Cells = append(row.Cells, LayoutCell{
			Value:     r.Keys[d],
			DimDepth:  d,
			MetricIdx: -1,
		})
	}
	for mi, m := range g.def.Metrics {
		row.Cells = append(row.Cells, LayoutCell{
			Value:     r.Values[m.Field],
			DimDepth:  -1,
			MetricIdx: mi,
		})
		for _, gs := range g.stack {
			gs.aggs[mi].Update(r.Values[m.Field])
		}
		g.root[mi].Update(r.Values[m.Field])
	}
	return row
}

// attachDetailTrace 为明细行的维度列附 Trace（指标列在 buildSubtotal 时处理）。
func (g *GroupStack) attachDetailTrace(cells []LayoutCell, rowNo int) []LayoutCell {
	for i := range cells {
		cells[i].Trace = &CellTrace{SourceCount: 1, SampleRows: []int{rowNo}}
	}
	return cells
}

// closeTop closes the innermost open group and appends its subtotal row.
// lastIdx is the row index of the group's last detail row, i.e. the last
// currently materialized row before the subtotal is appended.
func (g *GroupStack) closeTop() {
	gs := g.stack[len(g.stack)-1]

	// Build the path from the full stack BEFORE popping.
	path := make([]string, 0, len(g.stack))
	for _, s := range g.stack {
		path = append(path, s.key)
	}
	g.stack = g.stack[:len(g.stack)-1]

	lastIdx := len(g.Layout.Rows) - 1
	row := &LayoutRow{
		Type:      style.RowSubtotal,
		Level:     gs.depth,
		GroupPath: path,
	}
	for d := range g.def.Dimensions {
		var v any
		switch {
		case d < gs.depth:
			// Outer groups remain on the stack after the pop.
			v = g.stack[d].key
		case d == gs.depth:
			v = gs.key
		}
		row.Cells = append(row.Cells, LayoutCell{Value: v, DimDepth: d, MetricIdx: -1})
	}
	for mi := range g.def.Metrics {
		row.Cells = append(row.Cells, LayoutCell{
			Value:     gs.aggs[mi].Value(),
			DimDepth:  -1,
			MetricIdx: mi,
			SubRange:  SubRange{FromIdx: gs.startIdx, ToIdx: lastIdx},
			HasRange:  true,
			Trace: &CellTrace{
				SourceCount: gs.detailCount,
				SampleRows:  append([]int(nil), gs.detailSamples...),
			},
		})
	}
	g.Layout.Rows = append(g.Layout.Rows, row)
}

// Finish closes all open groups and appends (or prepends) the grand total row.
func (g *GroupStack) Finish() {
	for len(g.stack) > 0 {
		g.closeTop()
	}
	if len(g.Layout.Rows) == 0 {
		return
	}

	lastIdx := len(g.Layout.Rows) - 1
	total := &LayoutRow{Type: style.RowTotal}
	for d := range g.def.Dimensions {
		var v any
		if d == 0 {
			v = "总计"
		}
		total.Cells = append(total.Cells, LayoutCell{Value: v, DimDepth: d, MetricIdx: -1})
	}
	for mi := range g.def.Metrics {
		total.Cells = append(total.Cells, LayoutCell{
			Value:     g.root[mi].Value(),
			DimDepth:  -1,
			MetricIdx: mi,
			SubRange:  SubRange{FromIdx: 0, ToIdx: lastIdx},
			HasRange:  true,
			Trace:     &CellTrace{SourceCount: g.rootDetailCount, SampleRows: append([]int(nil), g.rootSamples...)},
		})
	}

	if g.def.LayoutOpts.TotalPosition == "top" {
		g.Layout.Rows = append([]*LayoutRow{total}, g.Layout.Rows...)
		// Compensate the insertion shift on every ranged cell.
		for _, r := range g.Layout.Rows {
			for ci := range r.Cells {
				if r.Cells[ci].HasRange {
					r.Cells[ci].SubRange.FromIdx++
					r.Cells[ci].SubRange.ToIdx++
				}
			}
		}
	} else {
		g.Layout.Rows = append(g.Layout.Rows, total)
	}
}
