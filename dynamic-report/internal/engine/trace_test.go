package engine

import (
	"reflect"
	"testing"
)

func rowNos(rn ...int) []int { return rn }

func TestTraceCollectedForSubtotalAndTotal(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}, RowNo: 1},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}, RowNo: 2},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300.0, "qty": 3}, RowNo: 3},
	)
	l := gs.Layout
	// 布局：0明细 1明细 2上海小计 3杭州明细 4杭州小计 5华东小计 6总计
	sub := l.Rows[2].Cells[2]
	if sub.Trace == nil || sub.Trace.SourceCount != 2 || !reflect.DeepEqual(sub.Trace.SampleRows, rowNos(1, 2)) {
		t.Fatalf("上海小计 trace = %+v", sub.Trace)
	}
	hd := l.Rows[5].Cells[2]
	if hd.Trace == nil || hd.Trace.SourceCount != 3 || !reflect.DeepEqual(hd.Trace.SampleRows, rowNos(1, 2, 3)) {
		t.Fatalf("华东小计 trace = %+v", hd.Trace)
	}
	total := l.Rows[6].Cells[2]
	if total.Trace == nil || total.Trace.SourceCount != 3 {
		t.Fatalf("总计 trace = %+v", total.Trace)
	}
	// 明细行 trace
	if l.Rows[0].Cells[0].Trace == nil || l.Rows[0].Cells[0].Trace.SourceCount != 1 ||
		!reflect.DeepEqual(l.Rows[0].Cells[0].Trace.SampleRows, rowNos(1)) {
		t.Fatalf("明细 trace = %+v", l.Rows[0].Cells[0].Trace)
	}
}

func TestTraceSampleCap(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	data := make([]DetailRow, 8)
	for i := range data {
		r := i + 1
		// 8 条都在同一城市组（RowNo 1..8）
		data[i] = DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": float64(r), "qty": 1}, RowNo: r}
	}
	rows(gs, data...)
	sub := gs.Layout.Rows[8].Cells[2] // 上海小计（8 条明细后紧跟，索引 8）
	if sub.Trace.SourceCount != 8 {
		t.Fatalf("count = %d", sub.Trace.SourceCount)
	}
	if len(sub.Trace.SampleRows) != 5 {
		t.Fatalf("samples = %v", sub.Trace.SampleRows)
	}
	if !reflect.DeepEqual(sub.Trace.SampleRows, rowNos(1, 2, 3, 4, 5)) {
		t.Fatalf("samples = %v", sub.Trace.SampleRows)
	}
}
