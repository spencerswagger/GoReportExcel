package model

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestLoadValid(t *testing.T) {
	def, err := Load("testdata/valid.json")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if def.ID != "rpt_sales" {
		t.Errorf("ID = %q, want %q", def.ID, "rpt_sales")
	}
	if len(def.Dimensions) != 2 {
		t.Errorf("len(Dimensions) = %d, want 2", len(def.Dimensions))
	}
	if len(def.Metrics) != 2 {
		t.Errorf("len(Metrics) = %d, want 2", len(def.Metrics))
	}
	if def.LayoutOpts.TotalPosition != "bottom" {
		t.Errorf("LayoutOpts.TotalPosition = %q, want %q", def.LayoutOpts.TotalPosition, "bottom")
	}
}

// TestLoadRejectsUnknownMetricField 验证指标引用了数据集中不存在的字段时 Load 报错。
func TestLoadRejectsUnknownMetricField(t *testing.T) {
	m := map[string]any{}
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &m); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	m["metrics"] = []map[string]string{{"field": "ghost", "label": "x", "agg": "SUM"}}
	bad, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal bad def: %v", err)
	}
	p := t.TempDir() + "/bad.json"
	if err := os.WriteFile(p, bad, 0o644); err != nil {
		t.Fatalf("write bad def: %v", err)
	}
	_, err = Load(p)
	if err == nil {
		t.Fatal("Load() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "ghost") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "ghost")
	}
}

func TestLoadRejectsBadAgg(t *testing.T) {
	m := map[string]any{}
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &m); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	m["metrics"] = []map[string]string{{"field": "amount", "label": "x", "agg": "MEDIAN"}}
	bad, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal bad def: %v", err)
	}
	p := t.TempDir() + "/bad.json"
	if err := os.WriteFile(p, bad, 0o644); err != nil {
		t.Fatalf("write bad def: %v", err)
	}
	_, err = Load(p)
	if err == nil {
		t.Fatal("Load() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "MEDIAN") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "MEDIAN")
	}
}

func TestValidateDefaultsTotalPosition(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	def.LayoutOpts.TotalPosition = ""
	if err := def.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if def.LayoutOpts.TotalPosition != "bottom" {
		t.Errorf("LayoutOpts.TotalPosition = %q, want %q", def.LayoutOpts.TotalPosition, "bottom")
	}
}

func TestValidateRejectsNumericDimensionField(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	// 维度字段类型必须是 string：把 region 字段类型改为 number，模拟数值维度。
	for i := range def.Dataset.Fields {
		if def.Dataset.Fields[i].Key == "region" {
			def.Dataset.Fields[i].Type = "number"
		}
	}
	err := def.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "region") || !strings.Contains(err.Error(), "number") {
		t.Errorf("error = %q, want it to contain %q and %q", err.Error(), "region", "number")
	}
}

func TestValidateRejectsOverrideBadRowType(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	def.Overrides = []OverrideDef{{
		ID:    "ov1",
		Scope: OverrideScope{RowType: "grand_total"},
		StylePatch: StylePatchJSON{
			Fill: &FillPatchJSON{Color: "#FFF"},
		},
	}}
	err := def.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "grand_total") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "grand_total")
	}
}

func TestValidateRejectsOverrideUnknownMetric(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	def.Overrides = []OverrideDef{{
		ID:         "ov2",
		Scope:      OverrideScope{Metric: "ghost"},
		StylePatch: StylePatchJSON{Fill: &FillPatchJSON{Color: "#FFF"}},
	}}
	err := def.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "ghost") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "ghost")
	}
}

func TestValidateRejectsCFUnknownKind(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	def.ConditionalFormats = []ConditionalFormat{{
		ID:    "cf1",
		Scope: CFScope{Metric: "amount"},
		Kind:  "sparkline",
	}}
	err := def.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "sparkline") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "sparkline")
	}
}

func TestPrintOptsValidation(t *testing.T) {
	var def ReportDefinition
	if err := json.Unmarshal(mustRead(t, "testdata/valid.json"), &def); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	def.LayoutOpts.Print = &PrintOpts{Orientation: "diagonal"}
	err := def.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "orientation") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "orientation")
	}
	// 先清空再设置合法打印选项。
	def.LayoutOpts.Print = nil
	def.LayoutOpts.Print = &PrintOpts{Orientation: "landscape", FitToWidth: 1, RepeatHeaderRows: 1}
	if err := def.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
}

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return b
}
