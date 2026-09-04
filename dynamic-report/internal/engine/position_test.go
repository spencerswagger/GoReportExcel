package engine

import (
	"reflect"
	"testing"
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
