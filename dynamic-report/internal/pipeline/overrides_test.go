package pipeline

import (
	"encoding/json"
	"testing"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

func ovDef() *model.ReportDefinition {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		panic(err)
	}
	def.Overrides = []model.OverrideDef{{
		ID: "ov_highlight",
		Scope: model.OverrideScope{GroupPathPrefix: []string{"华东"}, RowType: "subtotal", Metric: "amount"},
		StylePatch: model.StylePatchJSON{Fill: &model.FillPatchJSON{Color: "#FFF7E6"}, Bold: true},
	}}
	return def
}

func TestCompileOverrides(t *testing.T) {
	rules, err := CompileOverrides(ovDef())
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 1 {
		t.Fatalf("rules = %d", len(rules))
	}
	r := rules[0]
	if r.ID != "override:ov_highlight" || r.Priority != 10000 {
		t.Fatalf("rule = %+v", r)
	}
	if r.Style.Fill == nil || r.Style.Fill.Color != "#FFF7E6" || !r.Style.Bold {
		t.Fatalf("style = %+v", r.Style)
	}
	// when 必须同时包含 group_path prefix、row_type eq subtotal、col_role metric、metric_key amount
	all := r.When.All
	if len(all) == 0 {
		t.Fatal("expected all-combination condition")
	}
	kinds := map[string]bool{}
	for _, cond := range all {
		kinds[cond.Ctx+":"+cond.Op] = true
	}
	if !kinds["group_path:prefix"] || !kinds["row_type:eq"] || !kinds["col_role:eq"] || !kinds["metric_key:eq"] {
		t.Fatalf("cond kinds = %v", kinds)
	}
	// 一条命中一条不命中
	hit := &style.CellContext{RowType: style.RowSubtotal, GroupPath: []string{"华东", "上海"}, ColRole: style.ColMetric, MetricKey: "amount"}
	miss := &style.CellContext{RowType: style.RowSubtotal, GroupPath: []string{"华东", "上海"}, ColRole: style.ColMetric, MetricKey: "qty"}
	ok1, err := r.When.Eval(*hit)
	if err != nil || !ok1 {
		t.Fatalf("hit eval = %v err = %v", ok1, err)
	}
	ok2, _ := r.When.Eval(*miss)
	if ok2 {
		t.Fatal("qty should not match amount override")
	}
}

func TestCompileOverridesEmpty(t *testing.T) {
	def, _ := model.Load("../model/testdata/valid.json")
	rules, err := CompileOverrides(def)
	if err != nil || len(rules) != 0 {
		t.Fatalf("rules = %v err = %v", rules, err)
	}
}

func TestEngineResolveWithOverride(t *testing.T) {
	def := ovDef()
	rules, err := CompileOverrides(def)
	if err != nil {
		t.Fatal(err)
	}
	base, err := style.ParseRules(def.StyleRules)
	if err != nil {
		t.Fatal(err)
	}
	all := append(base.Rules, rules...)
	e := style.NewEngine(&style.RulesDoc{Rules: all})
	ctx := style.CellContext{RowType: style.RowSubtotal, GroupPath: []string{"华东", "上海"}, ColRole: style.ColMetric, MetricKey: "amount"}
	st, hits, err := e.Resolve(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.Fill != "#FFF7E6" || !st.Bold {
		t.Fatalf("override should win: %+v", st)
	}
	if hits[len(hits)-1] != "override:ov_highlight" {
		t.Fatalf("last hit = %v", hits)
	}
}

func TestCompileOverridesBadPatch(t *testing.T) {
	def := ovDef()
	raw := `[{"id":"bad","scope":{},"style_patch":{"border":{"top":{"style":"ultra"}}}}]`
	def.Overrides = nil
	_ = json.Unmarshal([]byte(raw), &def.Overrides)
	if _, err := CompileOverrides(def); err == nil {
		t.Fatal("expected invalid border style error")
	}
}

func TestCompileOverridesEmptyScopeSkipped(t *testing.T) {
	def := ovDef()
	// An override with no scope anchors must be skipped, not crash the build.
	def.Overrides = append(def.Overrides, model.OverrideDef{
		ID:         "ov_empty",
		Scope:      model.OverrideScope{},
		StylePatch: model.StylePatchJSON{Bold: true},
	})
	rules, err := CompileOverrides(def)
	if err != nil {
		t.Fatalf("CompileOverrides with empty scope: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("rules = %d, want 1 (empty-scope override skipped)", len(rules))
	}
	if rules[0].ID != "override:ov_highlight" {
		t.Fatalf("rule id = %q", rules[0].ID)
	}
}
