package style

import (
	"encoding/json"
	"testing"
)

// mustParse parses s as a style rules document, failing the test on error.
// The document is expected to contain exactly one rule whose When is used
// in the test.
func mustParse(t *testing.T, s string) *RulesDoc {
	t.Helper()
	doc, err := ParseRules(json.RawMessage(s))
	if err != nil {
		t.Fatalf("ParseRules: %v", err)
	}
	return doc
}

func TestEvalRowTypeIn(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "row_type", "op": "in", "values": ["detail", "subtotal"]},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{RowType: RowDetail})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("row_type detail should match in [detail, subtotal]")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{RowType: RowTotal})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("row_type total should not match in [detail, subtotal]")
	}
}

func TestEvalSeqMod(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "seq_in_group", "op": "eq", "mod": 2, "value": 0},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{SeqInGroup: 4})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("seq 4 mod 2 eq 0 should match")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{SeqInGroup: 3})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("seq 3 mod 2 eq 0 should not match")
	}
}

func TestEvalValueNumeric(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "value", "op": "lt", "value": 0},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{Value: -1.5})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("value -1.5 lt 0 should match")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{Value: "abc"})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("non-numeric value should be skipped silently")
	}
}

func TestEvalBetween(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "value", "op": "between", "values": [10, 20]},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{Value: 15})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("value 15 between [10, 20] should match")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{Value: 25})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("value 25 between [10, 20] should not match")
	}
}

func TestEvalGroupPathPrefix(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "group_path", "op": "prefix", "values": ["华东"]},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{GroupPath: []string{"华东", "上海"}})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal(`group_path ["华东","上海"] should prefix-match ["华东"]`)
	}
	got, err = doc.Rules[0].When.Eval(CellContext{GroupPath: []string{"华北"}})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal(`group_path ["华北"] should not prefix-match ["华东"]`)
	}
}

func TestEvalBoolFlags(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"ctx": "is_group_last_row", "op": "eq", "value": true},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{GroupLastRow: true})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("is_group_last_row eq true should match when flag is set")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{GroupLastRow: false})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("is_group_last_row eq true should not match when flag is clear")
	}
}

func TestEvalNotAndAny(t *testing.T) {
	doc := mustParse(t, `{
	  "rules": [
	    {"id": "r", "priority": 1,
	     "when": {"not": {"any": [
	       {"ctx": "row_type", "op": "eq", "value": "header"},
	       {"ctx": "row_type", "op": "eq", "value": "total"}
	     ]}},
	     "style": {}}
	  ]
	}`)
	got, err := doc.Rules[0].When.Eval(CellContext{RowType: RowDetail})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if !got {
		t.Fatal("not(any[header,total]) should match detail")
	}
	got, err = doc.Rules[0].When.Eval(CellContext{RowType: RowTotal})
	if err != nil {
		t.Fatalf("Eval: %v", err)
	}
	if got {
		t.Fatal("not(any[header,total]) should not match total")
	}
}

func TestBorderSideResolveAt(t *testing.T) {
	side := &BorderSide{At: "group_first_row", Style: "medium", Else: "hair"}

	got := side.Resolve(CellContext{GroupFirstRow: true})
	if got != "medium" {
		t.Fatalf("Resolve(GroupFirstRow=true)=%q, want medium", got)
	}
	got = side.Resolve(CellContext{GroupFirstRow: false})
	if got != "hair" {
		t.Fatalf("Resolve(GroupFirstRow=false)=%q, want hair", got)
	}

	plain := &BorderSide{Style: "double"}
	got = plain.Resolve(CellContext{})
	if got != "double" {
		t.Fatalf("Resolve(no at)=%q, want double", got)
	}
}
