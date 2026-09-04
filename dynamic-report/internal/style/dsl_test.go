package style

import (
	"encoding/json"
	"testing"
)

const validDoc = `{
  "version": 1,
  "rules": [
    {
      "id": "zebra",
      "priority": 50,
      "when": {
        "all": [
          {"ctx": "row_type", "op": "eq", "value": "detail"},
          {"ctx": "seq_in_group", "op": "eq", "mod": 2, "value": 0}
        ]
      },
      "style": {
        "fill": {"color": "#F5F7FA"}
      }
    },
    {
      "id": "border",
      "priority": 100,
      "when": {
        "ctx": "row_type",
        "op": "in",
        "values": ["detail", "subtotal"]
      },
      "style": {
        "border": {
          "top": {"at": "group_first_row", "style": "medium", "else": "hair"},
          "bottom": {"at": "group_last_row", "style": "medium", "else": "hair"}
        }
      }
    }
  ]
}`

func TestParseRulesValid(t *testing.T) {
	doc, err := ParseRules(json.RawMessage(validDoc))
	if err != nil {
		t.Fatalf("ParseRules: %v", err)
	}
	if len(doc.Rules) != 2 {
		t.Fatalf("len(rules)=%d, want 2", len(doc.Rules))
	}
	if doc.Rules[0].ID != "zebra" {
		t.Fatalf("Rules[0].ID=%q, want zebra", doc.Rules[0].ID)
	}
}

func TestParseRulesEmpty(t *testing.T) {
	doc, err := ParseRules(nil)
	if err != nil {
		t.Fatalf("ParseRules(nil): %v", err)
	}
	if len(doc.Rules) != 0 {
		t.Fatalf("len(rules)=%d, want 0", len(doc.Rules))
	}
}

func TestParseRulesRejectsDupID(t *testing.T) {
	raw := json.RawMessage(`{
	  "rules": [
	    {"id": "a", "priority": 1, "when": {"ctx": "row_type", "op": "eq", "value": "detail"}, "style": {}},
	    {"id": "a", "priority": 2, "when": {"ctx": "row_type", "op": "eq", "value": "detail"}, "style": {}}
	  ]
	}`)
	if _, err := ParseRules(raw); err == nil {
		t.Fatal("ParseRules: expected duplicate id error, got nil")
	}
}

func TestParseRulesRejectsBadLineStyle(t *testing.T) {
	raw := json.RawMessage(`{
	  "rules": [
	    {"id": "b", "priority": 1, "when": {"ctx": "row_type", "op": "eq", "value": "detail"},
	     "style": {"border": {"top": {"style": "ultra"}}}}
	  ]
	}`)
	if _, err := ParseRules(raw); err == nil {
		t.Fatal("ParseRules: expected bad line style error, got nil")
	}
}

func TestParseRulesRejectsBadAt(t *testing.T) {
	raw := json.RawMessage(`{
	  "rules": [
	    {"id": "c", "priority": 1, "when": {"ctx": "row_type", "op": "eq", "value": "detail"},
	     "style": {"border": {"top": {"at": "somewhere", "style": "medium"}}}}
	  ]
	}`)
	if _, err := ParseRules(raw); err == nil {
		t.Fatal("ParseRules: expected bad at error, got nil")
	}
}

func TestParseRulesRejectsBadCondOp(t *testing.T) {
	raw := json.RawMessage(`{
	  "rules": [
	    {"id": "d", "priority": 1, "when": {"ctx": "row_type", "op": "regex", "value": "x"}, "style": {}}
	  ]
	}`)
	if _, err := ParseRules(raw); err == nil {
		t.Fatal("ParseRules: expected bad cond op error, got nil")
	}
}
