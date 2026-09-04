package style

import (
	"testing"
)

func TestResolveZebraAndPriority(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "fill-low", "priority": 50,
	     "when": {"all": [
	       {"ctx": "row_type", "op": "eq", "value": "detail"},
	       {"ctx": "seq_in_group", "op": "eq", "mod": 2, "value": 0}
	     ]},
	     "style": {"fill": {"color": "#EEEEEE"}}},
	    {"id": "fill-high", "priority": 100,
	     "when": {"ctx": "seq_in_group", "op": "eq", "value": 2},
	     "style": {"fill": {"color": "#F5F7FA"}, "bold": true}}
	  ]
	}`)
	eng := NewEngine(doc)
	got, hits, err := eng.Resolve(CellContext{RowType: RowDetail, SeqInGroup: 2})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Fill != "#F5F7FA" {
		t.Fatalf("Fill=%q, want #F5F7FA", got.Fill)
	}
	if !got.Bold {
		t.Fatal("Bold should be true")
	}
	if len(hits) != 2 || hits[0] != "fill-low" || hits[1] != "fill-high" {
		t.Fatalf("hits=%v, want [fill-low fill-high]", hits)
	}
}

func TestResolveBordersPerSide(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "border", "priority": 10,
	     "when": {"ctx": "row_type", "op": "eq", "value": "detail"},
	     "style": {"border": {
	       "top": {"at": "group_first_row", "style": "medium", "else": "hair"},
	       "left": {"style": "medium"}
	     }}}
	  ]
	}`)
	eng := NewEngine(doc)

	got, _, err := eng.Resolve(CellContext{RowType: RowDetail, GroupFirstRow: true})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.BorderTop != "medium" {
		t.Fatalf("BorderTop=%q, want medium", got.BorderTop)
	}
	if got.BorderLeft != "medium" {
		t.Fatalf("BorderLeft=%q, want medium", got.BorderLeft)
	}

	got, _, err = eng.Resolve(CellContext{RowType: RowDetail, GroupFirstRow: false})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.BorderTop != "hair" {
		t.Fatalf("BorderTop=%q, want hair", got.BorderTop)
	}
	if got.BorderLeft != "medium" {
		t.Fatalf("BorderLeft=%q, want medium", got.BorderLeft)
	}
}

func TestResolveIndentExpr(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "indent", "priority": 10,
	     "when": {"ctx": "col_role", "op": "eq", "value": "dimension"},
	     "style": {"indent": {"expr": "dim_depth"}}}
	  ]
	}`)
	eng := NewEngine(doc)
	got, _, err := eng.Resolve(CellContext{ColRole: ColDimension, DimDepth: 2})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Indent != 2 {
		t.Fatalf("Indent=%d, want 2", got.Indent)
	}
}

func TestResolveNoRules(t *testing.T) {
	eng := NewEngine(&RulesDoc{})
	got, hits, err := eng.Resolve(CellContext{RowType: RowDetail})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != (ResolvedStyle{}) {
		t.Fatalf("ResolvedStyle=%+v, want zero value", got)
	}
	if len(hits) != 0 {
		t.Fatalf("hits=%v, want empty", hits)
	}
}
