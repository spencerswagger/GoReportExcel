package schema

import (
	"encoding/json"
	"testing"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// buildSample 从真实 testdata 构建定义与布局：
// model.Load → CSV Source.Rows(def) → NewGroupStack 逐条 Feed → Finish
// → PositionPass → AssemblyPass。
func buildSample(t *testing.T) (*model.ReportDefinition, *engine.Layout) {
	t.Helper()
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := datahub.NewCSVSource("../datahub/testdata/sales.csv").Rows(def)
	if err != nil {
		t.Fatal(err)
	}
	gs := engine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	engine.PositionPass(def, gs.Layout)
	engine.AssemblyPass(def, gs.Layout)
	return def, gs.Layout
}

func TestBuildSchemaSkeleton(t *testing.T) {
	def, l := buildSample(t)
	se := style.NewEngine(&style.RulesDoc{})
	s, err := Build(def, l, se, false)
	if err != nil {
		t.Fatal(err)
	}
	if s.SchemaVersion != 1 || len(s.Cols) != 4 {
		t.Fatalf("cols = %+v", s.Cols)
	}
	// 表头行 + 4 明细 + 5 小计（3 城市组 + 2 大区分组）+ 1 总计 = 11 行
	if len(s.Rows) != 11 {
		t.Fatalf("rows = %d", len(s.Rows))
	}
	if s.Rows[0].Type != "header" || s.Rows[0].Cells[0].Value != "大区" {
		t.Fatalf("header = %+v", s.Rows[0])
	}
	// 合并转物理坐标：上海组 city 列 布局 0..2 → 物理 2..4，列 C=2
	found := false
	for _, m := range s.Merges {
		if m.C == 2 && m.R1 == 2 && m.R2 == 4 {
			found = true
		}
	}
	if !found {
		t.Fatalf("merges = %+v", s.Merges)
	}
	// 列宽已钳制到 [8,40]
	for _, c := range s.Cols {
		if c.Width < 8 || c.Width > 40 {
			t.Fatalf("col width %v out of clamp", c.Width)
		}
	}
}

func TestBuildSchemaStylesAndFormulas(t *testing.T) {
	def, l := buildSample(t)
	def.StyleRules = json.RawMessage(`{"version":1,"rules":[
	  {"id":"zebra","priority":50,
	   "when":{"all":[
	     {"ctx":"row_type","op":"eq","value":"detail"},
	     {"ctx":"seq_in_group","mod":2,"op":"eq","value":0}]},
	   "style":{"fill":{"color":"#F5F7FA"}}}]}`)
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Build(def, l, style.NewEngine(doc), true)
	if err != nil {
		t.Fatal(err)
	}

	// 行序核对 dump：Rows[0]=表头(物理1)，Rows[i] 对应物理行 i+1。
	t.Logf("row dump (idx/type/seq):")
	for i, r := range s.Rows {
		t.Logf("  s.Rows[%d] Idx=%d Type=%s Seq=%d path=%v", i, r.Idx, r.Type, r.Seq, r.GroupPath)
	}

	// 小计行公式（seq 无关，直接找第一个带公式的单元格）
	var formula string
	for _, r := range s.Rows {
		for _, c := range r.Cells {
			if c.Formula != "" && formula == "" {
				formula = c.Formula
			}
		}
	}
	if formula == "" || formula[:9] != "=SUBTOTAL" {
		t.Fatalf("formula = %q", formula)
	}

	// zebra 命中行：seq=2 的明细行（上海第 2 条，布局 1，物理行 3）。
	// 实现采用 "Rows 先 header 后逐布局行"：s.Rows[0]=表头(物理1)，s.Rows[i]=物理行 i+1，
	// 故物理行 3 = s.Rows[2]。
	zebra := s.Rows[2]
	if zebra.Seq != 2 {
		t.Fatalf("expected seq2 detail at s.Rows[2] (physical 3), got Idx=%d Type=%s Seq=%d",
			zebra.Idx, zebra.Type, zebra.Seq)
	}
	st := s.Styles[zebra.Cells[2].Style]
	if st.Fill != "#F5F7FA" {
		t.Fatalf("zebra style = %+v", st)
	}
	if len(zebra.Cells[2].RuleHits) != 1 || zebra.Cells[2].RuleHits[0] != "zebra" {
		t.Fatalf("rule_hits = %v", zebra.Cells[2].RuleHits)
	}
}

func TestFormatDisplay(t *testing.T) {
	if got := FormatDisplay(12500.5, "#,##0.00"); got != "12,500.50" {
		t.Fatalf("got %q", got)
	}
	if got := FormatDisplay(12500.0, "#,##0"); got != "12,500" {
		t.Fatalf("got %q", got)
	}
	if got := FormatDisplay("华东", ""); got != "华东" {
		t.Fatalf("got %q", got)
	}
	if got := FormatDisplay(nil, "#,##0"); got != "" {
		t.Fatalf("got %q", got)
	}
}
