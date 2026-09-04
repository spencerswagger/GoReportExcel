package engine

import (
	"testing"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

func twoDimDef() *model.ReportDefinition {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		panic(err)
	}
	return def
}

func rows(gs *GroupStack, data ...DetailRow) {
	for _, d := range data {
		gs.Feed(d)
	}
	gs.Finish()
}

func TestGroupStackTwoLevel(t *testing.T) {
	def := twoDimDef()
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200, "qty": 2}},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300, "qty": 3}},
		DetailRow{Keys: []string{"华北", "北京"}, Values: map[string]any{"amount": 400, "qty": 4}},
	)

	wantTypes := []style.RowType{
		style.RowDetail, style.RowDetail, style.RowSubtotal,
		style.RowDetail, style.RowSubtotal, style.RowSubtotal,
		style.RowDetail, style.RowSubtotal, style.RowSubtotal,
		style.RowTotal,
	}
	if len(gs.Layout.Rows) != 10 {
		t.Fatalf("rows = %d, want 10", len(gs.Layout.Rows))
	}
	for i, wt := range wantTypes {
		if got := gs.Layout.Rows[i].Type; got != wt {
			t.Fatalf("rows[%d].Type = %v, want %v", i, got, wt)
		}
	}

	// rows[2] = 上海小计
	sh := gs.Layout.Rows[2]
	if sh.Level != 1 {
		t.Fatalf("rows[2].Level = %d, want 1", sh.Level)
	}
	if !sh.Cells[2].HasRange || sh.Cells[2].SubRange != (SubRange{0, 1}) {
		t.Fatalf("rows[2].Cells[2] HasRange/SubRange = %v/%v, want true/{0,1}",
			sh.Cells[2].HasRange, sh.Cells[2].SubRange)
	}
	if got := sh.Cells[2].Value.(float64); got != 300 {
		t.Fatalf("rows[2].Cells[2].Value = %v, want 300", got)
	}
	if got := sh.Cells[3].Value.(float64); got != 2 {
		t.Fatalf("rows[2].Cells[3].Value = %v, want 2", got)
	}

	// rows[5] = 华东小计
	h := gs.Layout.Rows[5]
	if h.Cells[2].SubRange != (SubRange{0, 4}) {
		t.Fatalf("rows[5].Cells[2].SubRange = %v, want {0,4}", h.Cells[2].SubRange)
	}
	if got := h.Cells[2].Value.(float64); got != 600 {
		t.Fatalf("rows[5].Cells[2].Value = %v, want 600", got)
	}

	// rows[7] = 北京小计
	if got := gs.Layout.Rows[7].Cells[2].SubRange; got != (SubRange{6, 6}) {
		t.Fatalf("rows[7].Cells[2].SubRange = %v, want {6,6}", got)
	}

	// rows[9] = 总计
	total := gs.Layout.Rows[9]
	if total.Cells[2].SubRange != (SubRange{0, 8}) {
		t.Fatalf("rows[9].Cells[2].SubRange = %v, want {0,8}", total.Cells[2].SubRange)
	}
	if got := total.Cells[2].Value.(float64); got != 1000 {
		t.Fatalf("rows[9].Cells[2].Value = %v, want 1000", got)
	}

	// seq
	seqs := []int{gs.Layout.Rows[0].SeqInGroup, gs.Layout.Rows[1].SeqInGroup,
		gs.Layout.Rows[3].SeqInGroup, gs.Layout.Rows[6].SeqInGroup}
	wantSeqs := []int{1, 2, 1, 1}
	for i, ws := range wantSeqs {
		if seqs[i] != ws {
			t.Fatalf("seq check %d = %d, want %d", i, seqs[i], ws)
		}
	}
}

func TestGroupStackZeroDim(t *testing.T) {
	def := twoDimDef()
	def.Dimensions = nil
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Values: map[string]any{"amount": 10, "qty": 1}},
		DetailRow{Values: map[string]any{"amount": 20, "qty": 2}},
	)

	if len(gs.Layout.Rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(gs.Layout.Rows))
	}
	if gs.Layout.Rows[0].Type != style.RowDetail ||
		gs.Layout.Rows[1].Type != style.RowDetail ||
		gs.Layout.Rows[2].Type != style.RowTotal {
		t.Fatalf("row types = %v,%v,%v, want detail,detail,total",
			gs.Layout.Rows[0].Type, gs.Layout.Rows[1].Type, gs.Layout.Rows[2].Type)
	}
	if gs.Layout.Rows[0].SeqInGroup != 1 || gs.Layout.Rows[1].SeqInGroup != 2 {
		t.Fatalf("seq = %d,%d, want 1,2",
			gs.Layout.Rows[0].SeqInGroup, gs.Layout.Rows[1].SeqInGroup)
	}
	if got := gs.Layout.Rows[2].Cells[0].SubRange; got != (SubRange{0, 1}) {
		t.Fatalf("total.Cells[0].SubRange = %v, want {0,1}", got)
	}
	if got := gs.Layout.Rows[2].Cells[0].Value.(float64); got != 30 {
		t.Fatalf("total.Cells[0].Value = %v, want 30", got)
	}
}

func TestGroupStackTotalTopShiftsRanges(t *testing.T) {
	def := twoDimDef()
	def.LayoutOpts.TotalPosition = "top"
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100, "qty": 1}},
	)

	if got := gs.Layout.Rows[0].Type; got != style.RowTotal {
		t.Fatalf("rows[0].Type = %v, want total", got)
	}
	if got := gs.Layout.Rows[0].Cells[2].SubRange; got != (SubRange{1, 3}) {
		t.Fatalf("total.Cells[2].SubRange = %v, want {1,3}", got)
	}
	// rows[1] = 上海明细, rows[2] = 上海小计
	if got := gs.Layout.Rows[2].Cells[2].SubRange; got != (SubRange{1, 1}) {
		t.Fatalf("rows[2].Cells[2].SubRange = %v, want {1,1}", got)
	}
}
