package datahub

import (
	"strings"
	"testing"

	"dynamic-report/internal/model"
)

func testDef() *model.ReportDefinition {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		panic(err)
	}
	return def
}

func TestCSVSourceSortBySortKey(t *testing.T) {
	src := NewCSVSource("testdata/sales.csv")
	rows, err := src.Rows(testDef())
	if err != nil {
		t.Fatalf("Rows() error = %v", err)
	}
	want := []string{"华东", "华东", "华东", "华北"}
	if len(rows) != len(want) {
		t.Fatalf("len(rows) = %d, want %d", len(rows), len(want))
	}
	for i, w := range want {
		if got := rows[i].Keys[0]; got != w {
			t.Errorf("rows[%d].Keys[0] = %q, want %q", i, got, w)
		}
	}
	am, ok := rows[0].Values["amount"].(float64)
	if !ok {
		t.Fatalf("rows[0].Values[amount] type = %T, want float64", rows[0].Values["amount"])
	}
	if am != 100 {
		t.Errorf("rows[0].Values[amount] = %v, want 100", am)
	}
}

func TestCSVSourceMissingColumn(t *testing.T) {
	def := testDef()
	def.Dataset.Fields = append(def.Dataset.Fields, model.FieldDef{Key: "ghost", Type: "number"})
	def.Metrics = append(def.Metrics, model.MetricDef{Field: "ghost", Label: "g", Agg: model.AggSum})
	src := NewCSVSource("testdata/sales.csv")
	_, err := src.Rows(def)
	if err == nil {
		t.Fatal("Rows() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "ghost") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "ghost")
	}
}

func TestSliceSource(t *testing.T) {
	src := NewSliceSource([]map[string]any{
		{"region": "华东", "city": "上海", "amount": 1.0, "qty": 1},
		{"region": "华北", "city": "北京", "amount": 2.0, "qty": 2},
	})
	rows, err := src.Rows(testDef())
	if err != nil {
		t.Fatalf("Rows() error = %v", err)
	}
	want := []string{"华东", "华北"}
	for i, w := range want {
		if got := rows[i].Keys[0]; got != w {
			t.Errorf("rows[%d].Keys[0] = %q, want %q", i, got, w)
		}
	}
}
