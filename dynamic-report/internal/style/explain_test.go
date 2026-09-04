package style

import "testing"

func TestExplainLeaf(t *testing.T) {
	c := Cond{Ctx: "row_type", Op: "eq", Value: "subtotal"}
	if got, want := c.Explain(), "row_type eq \"subtotal\""; got != want {
		t.Fatalf("explain = %q, want %q", got, want)
	}
	c2 := Cond{Ctx: "seq_in_group", Op: "eq", Mod: 2, Value: float64(0)}
	if got, want := c2.Explain(), "seq_in_group % 2 eq 0"; got != want {
		t.Fatalf("explain = %q, want %q", got, want)
	}
	c3 := Cond{Ctx: "metric_key", Op: "eq", Value: "amount"}
	if got, want := c3.Explain(), "metric_key eq \"amount\""; got != want {
		t.Fatalf("explain = %q, want %q", got, want)
	}
}

func TestExplainCombinators(t *testing.T) {
	c := Cond{All: []Cond{
		{Ctx: "row_type", Op: "eq", Value: "detail"},
		{Ctx: "col_role", Op: "eq", Value: "metric"},
	}}
	if got, want := c.Explain(), "all(row_type eq \"detail\", col_role eq \"metric\")"; got != want {
		t.Fatalf("explain = %q, want %q", got, want)
	}
}

func TestResolveTraced(t *testing.T) {
	doc := mustParse(t, `{"version":1,"rules":[
	  {"id":"zebra","priority":50,
	   "when":{"all":[
	     {"ctx":"row_type","op":"eq","value":"detail"},
	     {"ctx":"seq_in_group","mod":2,"op":"eq","value":0}]},
	   "style":{"fill":{"color":"#F5F7FA"}}},
	  {"id":"neg","priority":100,
	   "when":{"all":[
	     {"ctx":"col_role","op":"eq","value":"metric"},
	     {"ctx":"value","op":"lt","value":0}]},
	   "style":{"font_color":"#C0392B"}}]}`)
	e := NewEngine(doc)
	st, explains, err := e.ResolveTraced(&CellContext{RowType: RowDetail, SeqInGroup: 2, ColRole: ColMetric, Value: -5.0})
	if err != nil {
		t.Fatal(err)
	}
	if st.Fill != "#F5F7FA" || st.FontColor != "#C0392B" {
		t.Fatalf("style = %+v", st)
	}
	if len(explains) != 2 {
		t.Fatalf("explains = %v", explains)
	}
	if explains[0].ID != "zebra" || explains[1].ID != "neg" {
		t.Fatalf("ids = %v, %v", explains[0].ID, explains[1].ID)
	}
	// zebra 的原因应包含"命中"与条件文本
	for _, ex := range explains {
		if ex.Reason == "" {
			t.Fatalf("empty reason for %s", ex.ID)
		}
	}
}
