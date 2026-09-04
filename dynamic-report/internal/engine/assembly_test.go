package engine

import "testing"

func TestSubtotalFormula(t *testing.T) {
	if got := SubtotalFormula("SUM", "B", 2, 5); got != "=SUBTOTAL(9,B2:B5)" {
		t.Fatalf("SUM: got %q", got)
	}
	if got := SubtotalFormula("AVG", "C", 3, 3); got != "=SUBTOTAL(1,C3:C3)" {
		t.Fatalf("AVG: got %q", got)
	}
	if got := SubtotalFormula("COUNT", "D", 2, 9); got != "=SUBTOTAL(3,D2:D9)" {
		t.Fatalf("COUNT: got %q", got)
	}
}

func TestColumnName(t *testing.T) {
	cases := map[int]string{1: "A", 2: "B", 26: "Z", 27: "AA", 28: "AB"}
	for n, want := range cases {
		if got := ColumnName(n); got != want {
			t.Fatalf("ColumnName(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestAssemblyPassFillsFormulas(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}},
	)
	l := gs.Layout
	AssemblyPass(twoDimDef(), l)
	// 行序: 0明细 1明细 2上海小计 3华东小计 4总计；物理行 = idx+2
	sub := l.Rows[2].Cells[2]
	if sub.Formula != "=SUBTOTAL(9,C2:C3)" {
		t.Fatalf("上海小计 amount formula = %q", sub.Formula)
	}
	hd := l.Rows[3].Cells[3] // qty 是 COUNT（code 3），列 D
	if hd.Formula != "=SUBTOTAL(3,D2:D4)" {
		t.Fatalf("华东小计 qty formula = %q", hd.Formula)
	}
	total := l.Rows[4].Cells[2]
	if total.Formula != "=SUBTOTAL(9,C2:C5)" {
		t.Fatalf("总计 amount formula = %q", total.Formula)
	}
}
