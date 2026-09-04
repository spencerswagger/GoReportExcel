package engine

import (
	"reflect"
	"testing"

	"dynamic-report/internal/style"
)

func buildSampleLayout(t *testing.T) *GroupStack {
	t.Helper()
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300.0, "qty": 3}},
		DetailRow{Keys: []string{"华北", "北京"}, Values: map[string]any{"amount": 400.0, "qty": 4}},
	)
	return gs
}

func TestDisplayWidthCJK(t *testing.T) {
	if got := DisplayWidth("华东A"); got != 5 {
		t.Fatalf("DisplayWidth(\"华东A\") = %d, want 5", got)
	}
}

func TestPositionPassMergesAndFlags(t *testing.T) {
	gs := buildSampleLayout(t)
	l := gs.Layout
	PositionPass(twoDimDef(), l)
	// 行序（10 行，layout 下标）:
	//  0上海明细 1上海明细 2上海小计 3杭州明细 4杭州小计
	//  5华东小计 6北京明细 7北京小计 8华北小计 9总计
	if len(l.Rows) != 10 {
		t.Fatalf("rows = %d, want 10", len(l.Rows))
	}

	wantMerges := []MergeRange{
		{1, 0, 2}, // d1 上海组
		{1, 3, 4}, // d1 杭州组
		{0, 0, 5}, // d0 华东组含小计行5
		{1, 6, 7}, // d1 北京组
		{0, 6, 8}, // d0 华北组
	}
	if len(l.Merges) != len(wantMerges) {
		t.Fatalf("merges = %+v, want %+v", l.Merges, wantMerges)
	}
	for i, w := range wantMerges {
		if l.Merges[i] != w {
			t.Fatalf("merge[%d] = %+v, want %+v", i, l.Merges[i], w)
		}
	}

	// 首/末标志
	if got := l.Rows[0].FirstOfDepth; !reflect.DeepEqual(got, []bool{true, true}) {
		t.Fatalf("rows[0].FirstOfDepth = %v, want [true true]", got)
	}
	if got := l.Rows[2].LastOfDepth; !reflect.DeepEqual(got, []bool{false, true}) {
		t.Fatalf("rows[2].LastOfDepth = %v, want [false true]", got)
	}
	if got := l.Rows[4].LastOfDepth; !reflect.DeepEqual(got, []bool{false, true}) {
		t.Fatalf("rows[4].LastOfDepth = %v, want [false true]", got)
	}
	if got := l.Rows[5].LastOfDepth; !reflect.DeepEqual(got, []bool{true, false}) {
		t.Fatalf("rows[5].LastOfDepth = %v, want [true false]", got)
	}
	if got := l.Rows[8].LastOfDepth; !reflect.DeepEqual(got, []bool{true, false}) {
		t.Fatalf("rows[8].LastOfDepth = %v, want [true false]", got)
	}

	// 合并后非首行维度值被清空
	if l.Rows[1].Cells[0].Value != nil {
		t.Fatalf("rows[1].Cells[0].Value = %v, want nil", l.Rows[1].Cells[0].Value)
	}
	if got := l.Rows[0].Cells[0].Value; got != "华东" {
		t.Fatalf("rows[0].Cells[0].Value = %v, want 华东", got)
	}
}

func TestPositionPassColWidths(t *testing.T) {
	gs := buildSampleLayout(t)
	l := gs.Layout
	PositionPass(twoDimDef(), l)
	if len(l.ColWidths) != 4 {
		t.Fatalf("len(ColWidths) = %d, want 4", len(l.ColWidths))
	}
	// 大区列：表头"大区"宽 4，值"华东"宽 4 → >= 4
	if l.ColWidths[0] < 4 {
		t.Fatalf("ColWidths[0] = %v, want >= 4", l.ColWidths[0])
	}
}

func TestPositionPassZeroDimFlags(t *testing.T) {
	def := twoDimDef()
	def.Dimensions = nil
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Values: map[string]any{"amount": 1.0, "qty": 1}},
		DetailRow{Values: map[string]any{"amount": 2.0, "qty": 2}},
	)
	l := gs.Layout
	PositionPass(def, l)
	last := len(l.Rows) - 1
	if !l.Rows[0].GroupFirstRow() {
		t.Fatalf("rows[0].GroupFirstRow() = false, want true")
	}
	if !l.Rows[last].GroupLastRow() {
		t.Fatalf("rows[last].GroupLastRow() = false, want true")
	}
}

func TestGroupBoundaryByRowType(t *testing.T) {
	gs := buildSampleLayout(t)
	l := gs.Layout
	PositionPass(twoDimDef(), l)
	// 行序（10 行，layout 下标）:
	//  0上海明细 1上海明细 2上海小计 3杭州明细 4杭州小计
	//  5华东小计 6北京明细 7北京小计 8华北小计 9总计

	cases := []struct {
		idx       int
		name      string
		wantFirst bool
		wantLast  bool
	}{
		{2, "上海小计(Level=1)", false, true},
		{4, "杭州小计(Level=1)", false, true},
		{5, "华东小计(Level=0)", false, true},
		{7, "北京小计(Level=1)", false, true},
		{8, "华北小计(Level=0)", false, true},
		{9, "总计(bottom)", false, true},
		{0, "上海明细1", true, false},
		{1, "上海明细2", false, false},
		{3, "杭州明细", true, false},
		{6, "北京明细(单条明细组)", true, false},
	}
	for _, c := range cases {
		r := l.Rows[c.idx]
		if got := r.GroupFirstRow(); got != c.wantFirst {
			t.Errorf("rows[%d] %s: GroupFirstRow() = %v, want %v", c.idx, c.name, got, c.wantFirst)
		}
		if got := r.GroupLastRow(); got != c.wantLast {
			t.Errorf("rows[%d] %s: GroupLastRow() = %v, want %v", c.idx, c.name, got, c.wantLast)
		}
	}
}

func TestGroupBoundaryTotalTop(t *testing.T) {
	def := twoDimDef()
	def.LayoutOpts.TotalPosition = "top"
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
	)
	l := gs.Layout
	PositionPass(def, l)
	// 单条数据两维布局 + 置顶总计: 0总计 1明细 2上海小计 3华东小计，共 4 行
	if len(l.Rows) != 4 {
		t.Fatalf("rows = %d, want 4", len(l.Rows))
	}
	if r := l.Rows[0]; r.Type != style.RowTotal {
		t.Fatalf("rows[0].Type = %v, want total", r.Type)
	}
	if r := l.Rows[0]; !r.GroupFirstRow() || r.GroupLastRow() {
		t.Fatalf("total(top): GroupFirstRow/GroupLastRow = %v/%v, want true/false",
			r.GroupFirstRow(), r.GroupLastRow())
	}
	if r := l.Rows[1]; !r.GroupFirstRow() || r.GroupLastRow() {
		t.Fatalf("rows[1] 上海明细: GroupFirstRow/GroupLastRow = %v/%v, want true/false",
			r.GroupFirstRow(), r.GroupLastRow())
	}
	if r := l.Rows[2]; !r.GroupLastRow() {
		t.Fatalf("rows[2] 上海小计(Level=1): GroupLastRow() = false, want true")
	}
	if r := l.Rows[3]; !r.GroupLastRow() {
		t.Fatalf("rows[3] 华东小计(Level=0): GroupLastRow() = false, want true")
	}
}
