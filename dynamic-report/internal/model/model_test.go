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

func TestLoadRejectsUnknownField(t *testing.T) {
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

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return b
}
