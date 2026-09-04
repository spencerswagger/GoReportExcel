package schema

import (
	"encoding/json"
	"reflect"
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

func TestBuildRowHeightFromStyleRules(t *testing.T) {
	def, l := buildSample(t)
	def.StyleRules = json.RawMessage(`{"version":1,"rules":[
	  {"id":"subtotal-emphasis","priority":120,
	   "when":{"ctx":"row_type","op":"eq","value":"subtotal"},
	   "style":{"row_height":22}}]}`)
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Build(def, l, style.NewEngine(doc), false)
	if err != nil {
		t.Fatal(err)
	}

	// 行高是行级属性：subtotal 行由规则求得 Height==22，detail 行不受规则影响 Height==0。
	var subtotal, detail int
	for _, r := range s.Rows {
		switch r.Type {
		case "subtotal":
			subtotal++
			if r.Height != 22 {
				t.Errorf("subtotal row Idx=%d Height=%v, want 22", r.Idx, r.Height)
			}
		case "detail":
			detail++
			if r.Height != 0 {
				t.Errorf("detail row Idx=%d Height=%v, want 0", r.Idx, r.Height)
			}
		}
	}
	if subtotal == 0 || detail == 0 {
		t.Fatalf("expected both subtotal and detail rows, got subtotal=%d detail=%d", subtotal, detail)
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

func TestBuildSchemaExplains(t *testing.T) {
	def, err := model.Load("../model/testdata/overrides_test.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := datahub.NewCSVSource("../datahub/testdata/sales.csv").Rows(def)
	gs := engine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	engine.PositionPass(def, gs.Layout)
	engine.AssemblyPass(def, gs.Layout)
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Build(def, gs.Layout, style.NewEngine(doc), true)
	if err != nil {
		t.Fatal(err)
	}
	// zebra 命中的明细行（物理 3=布局 1，上海第 2 条）应带 Explains
	row := s.Rows[2]
	if len(row.Cells[2].Explains) == 0 {
		t.Fatalf("row3 explains = %v", row.Cells[2].Explains)
	}
	if row.Cells[2].Explains[0].Reason == "" {
		t.Fatal("empty reason")
	}
}

func TestPageRows(t *testing.T) {
	def, l := buildSample(t)
	s, err := Build(def, l, style.NewEngine(&style.RulesDoc{}), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PageRows(0, 4); err != nil {
		t.Fatal(err)
	}
	if len(s.Rows) != 5 {
		t.Fatalf("paged rows = %d", len(s.Rows))
	}
	if s.Rows[0].Idx != 1 || s.Rows[1].Idx != 2 {
		t.Fatalf("header must stay first: %+v", s.Rows[0])
	}
}

func TestBuildSchemaConditionalFormatsAndPrint(t *testing.T) {
	def, err := model.Load("../model/testdata/overrides_test.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := datahub.NewCSVSource("../datahub/testdata/sales.csv").Rows(def)
	gs := engine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	engine.PositionPass(def, gs.Layout)
	engine.AssemblyPass(def, gs.Layout)
	s, err := Build(def, gs.Layout, style.NewEngine(&style.RulesDoc{}), true)
	if err != nil {
		t.Fatal(err)
	}
	if s.PageSetup == nil || s.PageSetup.Orientation != "landscape" || s.PageSetup.RepeatHeaderRows != 1 || s.PageSetup.FitToWidth != 1 {
		t.Fatalf("page setup = %+v", s.PageSetup)
	}
	if len(s.ConditionalFormats) == 0 {
		t.Fatal("no conditional formats")
	}
	var dataBar *CFInfo
	var topCF *CFInfo
	for i := range s.ConditionalFormats {
		cf := &s.ConditionalFormats[i]
		if cf.Kind == "data_bar" {
			dataBar = cf
		}
		if cf.Kind == "top_n" {
			topCF = cf
		}
	}
	if dataBar == nil || len(dataBar.Ranges) != 1 || dataBar.Ranges[0] != "C2:C11" {
		t.Fatalf("data bar = %+v", dataBar)
	}
	if dataBar.Stats == nil || dataBar.Stats.Min != 100 || dataBar.Stats.Max != 1000 {
		t.Fatalf("data bar stats = %+v, want {100,1000}", dataBar.Stats)
	}
	// per_group top_n 按 3 个叶子组展开，区间收束到组内最后一条明细行（不含小计行）。
	want := []string{"C2:C3", "C5:C5", "C8:C8"}
	if topCF == nil || !reflect.DeepEqual(topCF.Ranges, want) {
		t.Fatalf("top_n ranges = %v, want %v", topCF.Ranges, want)
	}
}

func TestBuildSchemaOverrideInRuleHits(t *testing.T) {
	def, err := model.Load("../model/testdata/overrides_test.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := datahub.NewCSVSource("../datahub/testdata/sales.csv").Rows(def)
	gs := engine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	engine.PositionPass(def, gs.Layout)
	engine.AssemblyPass(def, gs.Layout)
	// 手工构造 override 伪规则（等价 pipeline.CompileOverrides 对 ov_ew 的产物），
	// 避免 schema→pipeline 依赖。
	doc := &style.RulesDoc{Rules: []style.Rule{
		{
			ID:       "override:ov_ew",
			Priority: 1000,
			When: style.Cond{All: []style.Cond{
				{Ctx: "group_path", Op: "prefix", Values: []any{"华东"}},
				{Ctx: "row_type", Op: "eq", Value: "subtotal"},
			}},
			Style: style.StyleSpec{Fill: &style.FillSpec{Color: "#FFF7E6"}, Bold: true},
		},
	}}
	s, err := Build(def, gs.Layout, style.NewEngine(doc), true)
	if err != nil {
		t.Fatal(err)
	}
	// 华东小计行：布局 R5（上海subtotal R2、杭州subtotal R4 之后）→ s.Rows[6]（物理7）。
	// 断言其 amount 指标列（Cells[2]）RuleHits 含 override:ov_ew。
	row := s.Rows[6]
	if row.Type != "subtotal" || row.GroupPath[0] != "华东" {
		t.Fatalf("expected 华东 subtotal at s.Rows[6], got %+v", row)
	}
	hits := row.Cells[2].RuleHits
	found := false
	for _, h := range hits {
		if h == "override:ov_ew" {
			found = true
		}
	}
	if !found {
		t.Fatalf("rule_hits = %v, want override:ov_ew", hits)
	}
}
