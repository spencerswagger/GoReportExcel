# 动态报表核心引擎与 CLI 导出 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现动态报表的 Go 核心管道（聚合、样式规则引擎、RenderSchema、excelize 渲染），交付一个可由"定义 JSON + CSV 数据"直接导出高保真 .xlsx 的 CLI。

**Architecture:** 纯物化单模式管道：有序明细流 → GroupStack 滚动聚合 → 布局物化 → P1 位置遍 / P2 样式遍 / P3 装配遍 → RenderSchema → excelize 渲染。对应设计文档 `/workspace/docs/superpowers/specs/2026-09-05-dynamic-report-service-design.md` 第 4-9、11、13 章；本计划是三期计划的第一期，不含服务化、前端与 override（override 依赖服务化后的交互，属计划二/三）。

**Tech Stack:** Go 1.22+、excelize v2、标准库 testing；无 Web 框架、无数据库。

---

## 文件结构

```
dynamic-report/
├── go.mod
├── cmd/reportgen/main.go                 # CLI：-def -data -o -schema-out
├── internal/model/model.go               # ReportDefinition 类型、加载、校验
├── internal/model/model_test.go
├── internal/style/dsl.go                 # DSL 类型与解析校验
├── internal/style/dsl_test.go
├── internal/style/context.go             # CellContext、RowType、ColRole、Cond.Eval、位置谓词
├── internal/style/context_test.go
├── internal/style/engine.go              # ResolvedStyle、Engine.Resolve、样式合并
├── internal/style/engine_test.go
├── internal/engine/aggregator.go         # SUM/AVG/COUNT/MIN/MAX 增量聚合
├── internal/engine/aggregator_test.go
├── internal/engine/groupstack.go         # GroupStack、LayoutStore、DetailRow
├── internal/engine/groupstack_test.go
├── internal/engine/position.go           # P1 位置遍：边界/合并/列宽
├── internal/engine/position_test.go
├── internal/engine/assembly.go           # P3 装配遍：公式生成
├── internal/engine/assembly_test.go
├── internal/datahub/source.go            # Source 接口、SliceSource、CSVSource
├── internal/datahub/source_test.go
├── internal/schema/schema.go             # RenderSchema 构建与 JSON
├── internal/schema/schema_test.go
├── internal/render/excel.go              # excelize 渲染
├── internal/render/excel_test.go
├── internal/pipeline/pipeline.go         # 管道装配（供 CLI 与测试复用）
├── internal/pipeline/pipeline_test.go
├── spikes/excelize_spike_test.go         # M0 技术验证（V1 条件格式/V2 缓存值/V3 打印标题/V4 性能）
└── testdata/e2e/                         # 端到端黄金夹具（定义+CSV+断言）
```

包依赖方向（无环）：`model` ← `style` ← `engine` ← `datahub/schema/render` ← `cmd`。
模块路径统一使用 `dynamic-report`（go.mod module 名）。

---

### Task 1: 初始化 Go 模块与目录骨架

**Files:**
- Create: `go.mod`
- Create: `.gitignore`

- [ ] **Step 1: 初始化模块**

```bash
mkdir -p dynamic-report && cd dynamic-report
go mod init dynamic-report
mkdir -p cmd/reportgen internal/model internal/style internal/engine internal/datahub internal/schema internal/render spikes testdata/e2e
```

- [ ] **Step 2: 添加依赖**

```bash
cd dynamic-report && go get github.com/qax-os/excelize/v2@v2.9.0
```

Expected: 下载成功；若 v2.9.0 不存在则用 `go get github.com/qax-os/excelize/v2@latest` 并记录实际版本到 spike 发现文档。

- [ ] **Step 3: 写 .gitignore**

```
/reportgen
*.xlsx
```

- [ ] **Step 4: 验证构建环境**

```bash
cd dynamic-report && go build ./...
```

Expected: 无输出（空模块构建成功）。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "chore: init go module for dynamic-report core"
```

---

### Task 2: excelize 能力 Spike（设计文档 13.3 节 V1-V4）

目的：在写渲染代码前验证 excelize 的真实 API 行为，把结论固化进代码注释与发现文档。

**Files:**
- Create: `spikes/excelize_spike_test.go`
- Create: `spikes/FINDINGS.md`

- [ ] **Step 1: 编写 spike 测试**

```go
package spikes

import (
	"bytes"
	"fmt"
	"testing"

	"github.com/qax-os/excelize/v2"
)

// V2 验证：公式 + 缓存值双写。
// 结论写入 FINDINGS.md：SetCellValue 与 SetCellFormula 的正确调用顺序，
// 以及重开文件后 GetCellValue 能否读到缓存值。
func TestSpikeFormulaCachedValue(t *testing.T) {
	f := excelize.NewFile()
	f.SetCellValue("Sheet1", "A1", 10)
	f.SetCellValue("Sheet1", "A2", 20)
	f.SetCellValue("Sheet1", "A3", 30) // 先写值作为缓存结果
	f.SetCellFormula("Sheet1", "A3", "=A1+A2")

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	g, err := excelize.OpenReader(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	formula, err := g.GetCellFormula("Sheet1", "A3")
	if err != nil || formula != "=A1+A2" {
		t.Fatalf("formula = %q, err = %v", formula, err)
	}
	v, _ := g.GetCellValue("Sheet1", "A3")
	t.Logf("cached value readback = %q (空字符串说明回读不到缓存值)", v)
}

// V1 验证：条件格式（数据条 / Top10）。API 形态以 go doc 为准：
//   go doc github.com/qax-os/excelize/v2 File.SetConditionalFormat
// 若当前版本接收 []excelize.Format，用本测试；若只接收 JSON 字符串，
// 改写为 JSON 形态并在 FINDINGS.md 记录。
func TestSpikeConditionalFormat(t *testing.T) {
	f := excelize.NewFile()
	for i := 1; i <= 5; i++ {
		f.SetCellValue("Sheet1", fmt.Sprintf("A%d", i), i*10)
	}
	err := f.SetConditionalFormat("Sheet1", "A1:A5", []excelize.Format{
		{Type: "data_bar", Color: "#638EC6"},
	})
	if err != nil {
		t.Fatalf("data_bar 条件格式失败（记录实际 API 到 FINDINGS.md）: %v", err)
	}
	err = f.SetConditionalFormat("Sheet1", "A1:A5", []excelize.Format{
		{Type: "top10", Criteria: ">", Value: "2", Format: 1},
	})
	if err != nil {
		t.Fatalf("top10 条件格式失败: %v", err)
	}
}

// V3 验证：打印标题（每页重复表头行），通过 defined name _xlnm.Print_Titles。
func TestSpikePrintTitles(t *testing.T) {
	f := excelize.NewFile()
	err := f.SetDefinedName(&excelize.DefinedName{
		Name:     "_xlnm.Print_Titles",
		RefersTo: "Sheet1!$1:$1",
	})
	if err != nil {
		t.Fatalf("打印标题写入失败（记录实际 API 到 FINDINGS.md）: %v", err)
	}
}

// V4 验证：1 万行写入耗时基线（渲染层性能预期）。
func TestSpikeWritePerf(t *testing.T) {
	f := excelize.NewFile()
	for r := 1; r <= 10000; r++ {
		for c := 1; c <= 6; c++ {
			f.SetCellValue("Sheet1", fmt.Sprintf("%s%d", colName(c), r), r*c)
		}
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	t.Logf("10000 行 x 6 列写入完成，字节数 = %d", buf.Len())
}

func colName(n int) string {
	s := ""
	for n > 0 {
		n--
		s = string(rune('A'+n%26)) + s
		n /= 26
	}
	return s
}
```

- [ ] **Step 2: 运行 spike 并记录结论**

Run: `cd dynamic-report && go test ./spikes/ -v`
Expected: 各用例输出结论。失败的用例不修复，把"实际 API 形态 / 失败原因"记录到 `spikes/FINDINGS.md`（每个验证项一段：结论 + 对渲染任务的影响）。若 `TestSpikeWritePerf` 超过 10 秒，在 FINDINGS.md 记录，并提示渲染任务考虑 StreamWriter。

- [ ] **Step 3: 提交**

```bash
git add spikes/ && git commit -m "spike: verify excelize conditional format, formula cache, print titles"
```

### Task 3: model 包 —— 定义加载与校验

**Files:**
- Create: `internal/model/model.go`
- Test: `internal/model/model_test.go`
- Create: `internal/model/testdata/valid.json`

- [ ] **Step 1: 写夹具 `internal/model/testdata/valid.json`**

```json
{
  "id": "rpt_sales", "version": 1, "name": "销售报表",
  "dataset": {
    "source_ref": "csv_local",
    "fields": [
      {"key": "region", "type": "string", "sort_key": "region_order"},
      {"key": "city", "type": "string"},
      {"key": "amount", "type": "number"},
      {"key": "qty", "type": "number"}
    ]
  },
  "dimensions": [
    {"field": "region", "label": "大区", "sort": {"by": "sort_key", "dir": "asc"}},
    {"field": "city", "label": "城市", "sort": {"by": "value", "dir": "asc"}}
  ],
  "metrics": [
    {"field": "amount", "label": "销售额", "agg": "SUM", "num_fmt_ref": "money"},
    {"field": "qty", "label": "件数", "agg": "COUNT", "num_fmt_ref": "int"}
  ],
  "layout_opts": {"total_position": "bottom"},
  "base_styles": {
    "header_font": {"name": "Arial", "size": 11, "bold": true},
    "body_font": {"name": "Arial", "size": 10},
    "num_formats": {"money": "#,##0.00", "int": "#,##0"}
  },
  "style_rules": {"version": 1, "rules": []}
}
```

- [ ] **Step 2: 写失败测试 `internal/model/model_test.go`**

```go
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
		t.Fatal(err)
	}
	if def.ID != "rpt_sales" || len(def.Dimensions) != 2 || len(def.Metrics) != 2 {
		t.Fatalf("unexpected def: %+v", def)
	}
	if def.LayoutOpts.TotalPosition != "bottom" {
		t.Fatalf("total_position = %q", def.LayoutOpts.TotalPosition)
	}
}

func TestLoadRejectsUnknownField(t *testing.T) {
	raw, _ := os.ReadFile("testdata/valid.json")
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	m["metrics"] = []map[string]any{{"field": "ghost", "label": "x", "agg": "SUM"}}
	b, _ := json.Marshal(m)
	tmp := t.TempDir() + "/bad.json"
	_ = os.WriteFile(tmp, b, 0o644)
	_, err := Load(tmp)
	if err == nil || !strings.Contains(err.Error(), "ghost") {
		t.Fatalf("expected unknown field error, got %v", err)
	}
}

func TestLoadRejectsBadAgg(t *testing.T) {
	raw, _ := os.ReadFile("testdata/valid.json")
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	m["metrics"] = []map[string]any{{"field": "amount", "label": "x", "agg": "MEDIAN"}}
	b, _ := json.Marshal(m)
	tmp := t.TempDir() + "/bad.json"
	_ = os.WriteFile(tmp, b, 0o644)
	if _, err := Load(tmp); err == nil || !strings.Contains(err.Error(), "MEDIAN") {
		t.Fatalf("expected agg error, got %v", err)
	}
}

func TestValidateDefaultsTotalPosition(t *testing.T) {
	def := &ReportDefinition{}
	_ = json.Unmarshal(mustRead(t, "testdata/valid.json"), def)
	def.LayoutOpts.TotalPosition = ""
	if err := def.Validate(); err != nil {
		t.Fatal(err)
	}
	if def.LayoutOpts.TotalPosition != "bottom" {
		t.Fatalf("default not applied: %q", def.LayoutOpts.TotalPosition)
	}
}

func mustRead(t *testing.T, p string) []byte {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/model/ -v`
Expected: 编译失败（类型未定义）。

- [ ] **Step 4: 实现 `internal/model/model.go`**

```go
package model

import (
	"encoding/json"
	"fmt"
	"os"
)

type AggFunc string

const (
	AggSum   AggFunc = "SUM"
	AggAvg   AggFunc = "AVG"
	AggCount AggFunc = "COUNT"
	AggMax   AggFunc = "MAX"
	AggMin   AggFunc = "MIN"
)

type FieldDef struct {
	Key     string `json:"key"`
	Type    string `json:"type"`
	SortKey string `json:"sort_key,omitempty"`
}

type SortSpec struct {
	By  string `json:"by"`
	Dir string `json:"dir"`
}

type DimensionDef struct {
	Field string   `json:"field"`
	Label string   `json:"label"`
	Sort  SortSpec `json:"sort"`
}

type MetricDef struct {
	Field     string  `json:"field"`
	Label     string  `json:"label"`
	Agg       AggFunc `json:"agg"`
	NumFmtRef string  `json:"num_fmt_ref,omitempty"`
}

type Dataset struct {
	SourceRef string     `json:"source_ref"`
	Fields    []FieldDef `json:"fields"`
	RowCap    int        `json:"row_cap,omitempty"`
}

type LayoutOpts struct {
	TotalPosition string `json:"total_position,omitempty"`
}

type FontSpec struct {
	Name string `json:"name,omitempty"`
	Size int    `json:"size,omitempty"`
	Bold bool   `json:"bold,omitempty"`
}

type BaseStyles struct {
	HeaderFont FontSpec          `json:"header_font"`
	BodyFont   FontSpec          `json:"body_font"`
	NumFormats map[string]string `json:"num_formats"`
}

// ReportDefinition 是报表定义的运行时表示。
// StyleRules 保留原始 JSON，由 style.ParseRules 解析（避免包间耦合）。
type ReportDefinition struct {
	ID         string          `json:"id"`
	Version    int             `json:"version"`
	Name       string          `json:"name"`
	Dataset    Dataset         `json:"dataset"`
	Dimensions []DimensionDef  `json:"dimensions"`
	Metrics    []MetricDef     `json:"metrics"`
	LayoutOpts LayoutOpts      `json:"layout_opts"`
	BaseStyles BaseStyles      `json:"base_styles"`
	StyleRules json.RawMessage `json:"style_rules"`
}

func Load(path string) (*ReportDefinition, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var def ReportDefinition
	if err := json.Unmarshal(data, &def); err != nil {
		return nil, fmt.Errorf("parse definition: %w", err)
	}
	if err := def.Validate(); err != nil {
		return nil, err
	}
	return &def, nil
}

func (d *ReportDefinition) Validate() error {
	if len(d.Metrics) == 0 {
		return fmt.Errorf("metrics: at least one required")
	}
	fields := map[string]bool{}
	for _, f := range d.Dataset.Fields {
		fields[f.Key] = true
	}
	for _, dim := range d.Dimensions {
		if !fields[dim.Field] {
			return fmt.Errorf("dimension %q: field not in dataset", dim.Field)
		}
		if dim.Sort.By != "sort_key" && dim.Sort.By != "value" {
			return fmt.Errorf("dimension %q: invalid sort.by %q", dim.Field, dim.Sort.By)
		}
		if dim.Sort.Dir != "asc" && dim.Sort.Dir != "desc" {
			return fmt.Errorf("dimension %q: invalid sort.dir %q", dim.Field, dim.Sort.Dir)
		}
	}
	for _, m := range d.Metrics {
		if !fields[m.Field] {
			return fmt.Errorf("metric %q: field not in dataset", m.Field)
		}
		switch m.Agg {
		case AggSum, AggAvg, AggCount, AggMax, AggMin:
		default:
			return fmt.Errorf("metric %q: invalid agg %q", m.Field, m.Agg)
		}
	}
	if d.LayoutOpts.TotalPosition == "" {
		d.LayoutOpts.TotalPosition = "bottom"
	}
	if d.LayoutOpts.TotalPosition != "bottom" && d.LayoutOpts.TotalPosition != "top" {
		return fmt.Errorf("layout_opts.total_position: invalid %q", d.LayoutOpts.TotalPosition)
	}
	return nil
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/model/ -v`
Expected: 4 个用例全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add internal/model && git commit -m "feat(model): report definition loading and validation"
```

---

### Task 4: style 包 —— DSL 类型与解析校验

**Files:**
- Create: `internal/style/dsl.go`
- Test: `internal/style/dsl_test.go`

- [ ] **Step 1: 写失败测试 `internal/style/dsl_test.go`**

```go
package style

import "testing"

const validDoc = `{
  "version": 1,
  "rules": [
    {"id": "zebra", "priority": 50,
     "when": {"all": [
       {"ctx": "row_type", "op": "eq", "value": "detail"},
       {"ctx": "seq_in_group", "mod": 2, "op": "eq", "value": 0}
     ]},
     "style": {"fill": {"color": "#F5F7FA"}}},
    {"id": "border", "priority": 100,
     "when": {"ctx": "row_type", "op": "in", "values": ["detail", "subtotal"]},
     "style": {"border": {
       "top": {"at": "group_first_row", "style": "medium", "else": "hair"},
       "bottom": {"at": "group_last_row", "style": "medium", "else": "hair"}
     }}}
  ]
}`

func TestParseRulesValid(t *testing.T) {
	doc, err := ParseRules([]byte(validDoc))
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Rules) != 2 || doc.Rules[0].ID != "zebra" {
		t.Fatalf("unexpected doc: %+v", doc)
	}
}

func TestParseRulesEmpty(t *testing.T) {
	doc, err := ParseRules(nil)
	if err != nil || len(doc.Rules) != 0 {
		t.Fatalf("doc=%+v err=%v", doc, err)
	}
}

func TestParseRulesRejectsDupID(t *testing.T) {
	bad := `{"version":1,"rules":[
	  {"id":"a","priority":1,"when":{"ctx":"value","op":"gt","value":0},"style":{"bold":true}},
	  {"id":"a","priority":2,"when":{"ctx":"value","op":"gt","value":0},"style":{"bold":true}}]}`
	if _, err := ParseRules([]byte(bad)); err == nil {
		t.Fatal("expected duplicated id error")
	}
}

func TestParseRulesRejectsBadLineStyle(t *testing.T) {
	bad := `{"version":1,"rules":[
	  {"id":"a","priority":1,"when":{"ctx":"value","op":"gt","value":0},
	   "style":{"border":{"top":{"style":"ultra"}}}}]}`
	if _, err := ParseRules([]byte(bad)); err == nil {
		t.Fatal("expected invalid line style error")
	}
}

func TestParseRulesRejectsBadAt(t *testing.T) {
	bad := `{"version":1,"rules":[
	  {"id":"a","priority":1,"when":{"ctx":"value","op":"gt","value":0},
	   "style":{"border":{"top":{"at":"somewhere","style":"thin"}}}}]}`
	if _, err := ParseRules([]byte(bad)); err == nil {
		t.Fatal("expected invalid at-predicate error")
	}
}

func TestParseRulesRejectsBadCondOp(t *testing.T) {
	bad := `{"version":1,"rules":[
	  {"id":"a","priority":1,"when":{"ctx":"value","op":"regex","value":"x"},"style":{"bold":true}}]}`
	if _, err := ParseRules([]byte(bad)); err == nil {
		t.Fatal("expected invalid op error")
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/style/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/style/dsl.go`**

```go
package style

import (
	"encoding/json"
	"fmt"
	"sort"
)

type RulesDoc struct {
	Version int    `json:"version"`
	Rules   []Rule `json:"rules"`
}

type Rule struct {
	ID       string    `json:"id"`
	Priority int       `json:"priority"`
	When     Cond      `json:"when"`
	Style    StyleSpec `json:"style"`
}

// Cond 是递归条件：组合器（All/Any/Not）或叶子（Ctx+Op）。
type Cond struct {
	All    []Cond `json:"all,omitempty"`
	Any    []Cond `json:"any,omitempty"`
	Not    *Cond  `json:"not,omitempty"`
	Ctx    string `json:"ctx,omitempty"`
	Op     string `json:"op,omitempty"`
	Value  any    `json:"value,omitempty"`
	Values []any  `json:"values,omitempty"`
	Mod    int    `json:"mod,omitempty"`
}

type BorderSide struct {
	At    string `json:"at,omitempty"`
	Style string `json:"style"`
	Else  string `json:"else,omitempty"`
}

type BorderSpec struct {
	Top    *BorderSide `json:"top,omitempty"`
	Bottom *BorderSide `json:"bottom,omitempty"`
	Left   *BorderSide `json:"left,omitempty"`
	Right  *BorderSide `json:"right,omitempty"`
}

type FillSpec struct {
	Color string `json:"color"`
}

type IndentSpec struct {
	Expr  string `json:"expr,omitempty"`
	Value int    `json:"value,omitempty"`
}

// StyleSpec 只包含布局属性；字体/数字格式不在其中，
// 样式解耦由类型系统强制保证（设计文档 5.1）。
type StyleSpec struct {
	Border    *BorderSpec `json:"border,omitempty"`
	Fill      *FillSpec   `json:"fill,omitempty"`
	FontColor string      `json:"font_color,omitempty"`
	Bold      bool        `json:"bold,omitempty"`
	RowHeight float64     `json:"row_height,omitempty"`
	Indent    *IndentSpec `json:"indent,omitempty"`
}

var validLineStyle = map[string]bool{
	"hair": true, "thin": true, "medium": true,
	"thick": true, "double": true, "dashed": true,
}

var validAt = map[string]bool{
	"": true, "always": true,
	"group_first_row": true, "group_last_row": true,
	"group_first_col": true, "group_last_col": true,
	"sheet_first_row": true, "sheet_last_row": true,
}

var validCondOp = map[string]bool{
	"eq": true, "ne": true, "in": true,
	"gt": true, "gte": true, "lt": true, "lte": true,
	"between": true, "prefix": true, "odd": true, "even": true,
}

var validCtx = map[string]bool{
	"row_type": true, "col_role": true, "dim_depth": true,
	"seq_in_group": true, "group_path": true, "value": true,
	"metric_key": true, "dim_key": true,
	"is_group_first_row": true, "is_group_last_row": true,
	"is_group_first_col": true, "is_group_last_col": true,
	"is_sheet_first_row": true, "is_sheet_last_row": true,
}

func ParseRules(raw json.RawMessage) (*RulesDoc, error) {
	doc := &RulesDoc{}
	if len(raw) == 0 {
		return doc, nil
	}
	if err := json.Unmarshal(raw, doc); err != nil {
		return nil, fmt.Errorf("parse style_rules: %w", err)
	}
	if err := doc.Validate(); err != nil {
		return nil, err
	}
	sort.SliceStable(doc.Rules, func(i, j int) bool {
		return doc.Rules[i].Priority < doc.Rules[j].Priority
	})
	return doc, nil
}

func (d *RulesDoc) Validate() error {
	ids := map[string]bool{}
	for i, r := range d.Rules {
		if r.ID == "" {
			return fmt.Errorf("rules[%d]: empty id", i)
		}
		if ids[r.ID] {
			return fmt.Errorf("rule %q: duplicated id", r.ID)
		}
		ids[r.ID] = true
		if err := r.When.validate("rules[" + r.ID + "].when"); err != nil {
			return err
		}
		if err := r.Style.validate("rules[" + r.ID + "].style"); err != nil {
			return err
		}
	}
	return nil
}

func (c *Cond) validate(path string) error {
	combos := 0
	if len(c.All) > 0 {
		combos++
	}
	if len(c.Any) > 0 {
		combos++
	}
	if c.Not != nil {
		combos++
	}
	if combos > 1 {
		return fmt.Errorf("%s: all/any/not are mutually exclusive", path)
	}
	if combos == 1 {
		for i := range c.All {
			if err := c.All[i].validate(fmt.Sprintf("%s.all[%d]", path, i)); err != nil {
				return err
			}
		}
		for i := range c.Any {
			if err := c.Any[i].validate(fmt.Sprintf("%s.any[%d]", path, i)); err != nil {
				return err
			}
		}
		if c.Not != nil {
			return c.Not.validate(path + ".not")
		}
		return nil
	}
	if !validCtx[c.Ctx] {
		return fmt.Errorf("%s: unknown ctx %q", path, c.Ctx)
	}
	if !validCondOp[c.Op] {
		return fmt.Errorf("%s: invalid op %q", path, c.Op)
	}
	return nil
}

func (s *StyleSpec) validate(path string) error {
	if s.Border != nil {
		for name, side := range map[string]*BorderSide{
			"top": s.Border.Top, "bottom": s.Border.Bottom,
			"left": s.Border.Left, "right": s.Border.Right,
		} {
			if side == nil {
				continue
			}
			if !validLineStyle[side.Style] {
				return fmt.Errorf("%s.border.%s: invalid line style %q", path, name, side.Style)
			}
			if side.Else != "" && !validLineStyle[side.Else] {
				return fmt.Errorf("%s.border.%s: invalid else style %q", path, name, side.Else)
			}
			if !validAt[side.At] {
				return fmt.Errorf("%s.border.%s: invalid at %q", path, name, side.At)
			}
		}
	}
	if s.Indent != nil && s.Indent.Expr != "" && s.Indent.Expr != "dim_depth" {
		return fmt.Errorf("%s.indent: unknown expr %q", path, s.Indent.Expr)
	}
	return nil
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/style/ -v -run TestParseRules`
Expected: 6 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/style && git commit -m "feat(style): DSL types, parsing and validation"
```

---

### Task 5: style 包 —— CellContext、Cond.Eval 与位置谓词

**Files:**
- Create: `internal/style/context.go`
- Test: `internal/style/context_test.go`

- [ ] **Step 1: 写失败测试 `internal/style/context_test.go`**

```go
package style

import "testing"

func mustParse(t *testing.T, s string) *RulesDoc {
	t.Helper()
	doc, err := ParseRules([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestEvalRowTypeIn(t *testing.T) {
	doc := mustParse(t, `{"version":1,"rules":[
	  {"id":"r","priority":1,"when":{"ctx":"row_type","op":"in","values":["detail","subtotal"]},
	   "style":{"bold":true}}]}`)
	c := doc.Rules[0].When
	if ok, err := c.Eval(&CellContext{RowType: RowDetail}); err != nil || !ok {
		t.Fatalf("detail: ok=%v err=%v", ok, err)
	}
	if ok, _ := c.Eval(&CellContext{RowType: RowTotal}); ok {
		t.Fatal("total should not match")
	}
}

func TestEvalSeqMod(t *testing.T) {
	c := Cond{Ctx: "seq_in_group", Op: "eq", Mod: 2, Value: float64(0)}
	if ok, _ := c.Eval(&CellContext{SeqInGroup: 4}); !ok {
		t.Fatal("seq 4 mod 2 == 0 should match")
	}
	if ok, _ := c.Eval(&CellContext{SeqInGroup: 3}); ok {
		t.Fatal("seq 3 should not match")
	}
}

func TestEvalValueNumeric(t *testing.T) {
	c := Cond{Ctx: "value", Op: "lt", Value: float64(0)}
	if ok, _ := c.Eval(&CellContext{Value: -1.5}); !ok {
		t.Fatal("-1.5 < 0 should match")
	}
	if ok, _ := c.Eval(&CellContext{Value: "abc"}); ok {
		t.Fatal("non-numeric value should not match numeric predicate")
	}
}

func TestEvalBetween(t *testing.T) {
	c := Cond{Ctx: "value", Op: "between", Values: []any{float64(10), float64(20)}}
	if ok, _ := c.Eval(&CellContext{Value: 15}); !ok {
		t.Fatal("15 in [10,20] should match")
	}
	if ok, _ := c.Eval(&CellContext{Value: 25}); ok {
		t.Fatal("25 should not match")
	}
}

func TestEvalGroupPathPrefix(t *testing.T) {
	c := Cond{Ctx: "group_path", Op: "prefix", Values: []any{"华东"}}
	if ok, _ := c.Eval(&CellContext{GroupPath: []string{"华东", "上海"}}); !ok {
		t.Fatal("prefix 华东 should match")
	}
	if ok, _ := c.Eval(&CellContext{GroupPath: []string{"华北"}}); ok {
		t.Fatal("华北 should not match")
	}
}

func TestEvalBoolFlags(t *testing.T) {
	c := Cond{Ctx: "is_group_last_row", Op: "eq", Value: true}
	if ok, _ := c.Eval(&CellContext{GroupLastRow: true}); !ok {
		t.Fatal("flag true should match")
	}
}

func TestEvalNotAndAny(t *testing.T) {
	c := Cond{Not: &Cond{Any: []Cond{
		{Ctx: "row_type", Op: "eq", Value: "header"},
		{Ctx: "row_type", Op: "eq", Value: "total"},
	}}}
	if ok, _ := c.Eval(&CellContext{RowType: RowDetail}); !ok {
		t.Fatal("detail should match not(any(header,total))")
	}
	if ok, _ := c.Eval(&CellContext{RowType: RowTotal}); ok {
		t.Fatal("total should not match")
	}
}

func TestBorderSideResolveAt(t *testing.T) {
	b := &BorderSide{At: "group_first_row", Style: "medium", Else: "hair"}
	if got := b.Resolve(&CellContext{GroupFirstRow: true}); got != "medium" {
		t.Fatalf("got %q", got)
	}
	if got := b.Resolve(&CellContext{GroupFirstRow: false}); got != "hair" {
		t.Fatalf("got %q", got)
	}
	plain := &BorderSide{Style: "thin"}
	if got := plain.Resolve(&CellContext{}); got != "thin" {
		t.Fatalf("no-at side should always resolve to its style, got %q", got)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/style/ -v -run 'TestEval|TestBorderSide'`
Expected: 编译失败（CellContext 未定义）。

- [ ] **Step 3: 实现 `internal/style/context.go`**

```go
package style

import "fmt"

type RowType uint8

const (
	RowHeader RowType = iota
	RowDetail
	RowSubtotal
	RowTotal
)

func (r RowType) String() string {
	return [...]string{"header", "detail", "subtotal", "total"}[r]
}

type ColRole uint8

const (
	ColDimension ColRole = iota
	ColMetric
)

func (c ColRole) String() string {
	return [...]string{"dimension", "metric"}[c]
}

// CellContext 是规则引擎的唯一求值输入（设计文档第 6 节）。
// 语义字段（GroupPath/SeqInGroup/Value）由聚合阶段写入；
// 位置标志由 P1 位置遍写入。
type CellContext struct {
	Row, Col int
	RowType  RowType
	ColRole  ColRole
	DimDepth int

	GroupPath  []string
	SeqInGroup int
	MetricKey  string
	DimKey     string

	GroupFirstRow bool
	GroupLastRow  bool
	GroupFirstCol bool
	GroupLastCol  bool
	SheetFirstRow bool
	SheetLastRow  bool

	Value any
}

func (c *Cond) Eval(ctx *CellContext) (bool, error) {
	if len(c.All) > 0 {
		for i := range c.All {
			ok, err := c.All[i].Eval(ctx)
			if err != nil || !ok {
				return false, err
			}
		}
		return true, nil
	}
	if len(c.Any) > 0 {
		for i := range c.Any {
			ok, err := c.Any[i].Eval(ctx)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil
	}
	if c.Not != nil {
		ok, err := c.Not.Eval(ctx)
		return !ok, err
	}
	return c.evalLeaf(ctx)
}

func (c *Cond) evalLeaf(ctx *CellContext) (bool, error) {
	switch c.Ctx {
	case "row_type":
		return matchStrings(ctx.RowType.String(), c), nil
	case "col_role":
		return matchStrings(ctx.ColRole.String(), c), nil
	case "dim_depth":
		return matchNumber(float64(ctx.DimDepth), c), nil
	case "seq_in_group":
		return matchNumber(float64(ctx.SeqInGroup), c), nil
	case "group_path":
		if c.Op == "prefix" {
			for i, v := range c.Values {
				s, _ := v.(string)
				if i >= len(ctx.GroupPath) || ctx.GroupPath[i] != s {
					return false, nil
				}
			}
			return true, nil
		}
		return false, fmt.Errorf("group_path supports only op=prefix")
	case "value":
		f, ok := asNumber(ctx.Value)
		if !ok {
			return false, nil // 非数值值不匹配数值谓词，静默跳过
		}
		return matchNumber(f, c), nil
	case "is_group_first_row":
		return boolEq(ctx.GroupFirstRow, c)
	case "is_group_last_row":
		return boolEq(ctx.GroupLastRow, c)
	case "is_group_first_col":
		return boolEq(ctx.GroupFirstCol, c)
	case "is_group_last_col":
		return boolEq(ctx.GroupLastCol, c)
	case "is_sheet_first_row":
		return boolEq(ctx.SheetFirstRow, c)
	case "is_sheet_last_row":
		return boolEq(ctx.SheetLastRow, c)
	}
	return false, fmt.Errorf("unsupported ctx %q", c.Ctx)
}

func boolEq(got bool, c *Cond) (bool, error) {
	want, _ := c.Value.(bool)
	return got == want, nil
}

func matchStrings(got string, c *Cond) bool {
	switch c.Op {
	case "eq":
		s, _ := c.Value.(string)
		return got == s
	case "ne":
		s, _ := c.Value.(string)
		return got != s
	case "in":
		for _, v := range c.Values {
			if s, _ := v.(string); s == got {
				return true
			}
		}
		return false
	}
	return false
}

func matchNumber(got float64, c *Cond) bool {
	if c.Mod > 0 {
		got = float64(int(got) % c.Mod)
	}
	want, _ := asNumber(c.Value)
	switch c.Op {
	case "eq":
		return got == want
	case "ne":
		return got != want
	case "gt":
		return got > want
	case "gte":
		return got >= want
	case "lt":
		return got < want
	case "lte":
		return got <= want
	case "between":
		if len(c.Values) != 2 {
			return false
		}
		lo, _ := asNumber(c.Values[0])
		hi, _ := asNumber(c.Values[1])
		return got >= lo && got <= hi
	case "odd":
		return int(got)%2 == 1
	case "even":
		return int(got)%2 == 0
	}
	return false
}

func asNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	return 0, false
}

// Resolve 把带位置谓词的边框边解析为具体线型。
func (b *BorderSide) Resolve(ctx *CellContext) string {
	if b.At == "" || b.At == "always" || atFlag(b.At, ctx) {
		return b.Style
	}
	return b.Else
}

func atFlag(at string, ctx *CellContext) bool {
	switch at {
	case "group_first_row":
		return ctx.GroupFirstRow
	case "group_last_row":
		return ctx.GroupLastRow
	case "group_first_col":
		return ctx.GroupFirstCol
	case "group_last_col":
		return ctx.GroupLastCol
	case "sheet_first_row":
		return ctx.SheetFirstRow
	case "sheet_last_row":
		return ctx.SheetLastRow
	}
	return false
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/style/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/style && git commit -m "feat(style): CellContext, predicate evaluation and at-clause resolution"
```

---

### Task 6: style 包 —— StyleEngine.Resolve 与样式合并

**Files:**
- Create: `internal/style/engine.go`
- Test: `internal/style/engine_test.go`

- [ ] **Step 1: 写失败测试 `internal/style/engine_test.go`**

```go
package style

import "testing"

func TestResolveZebraAndPriority(t *testing.T) {
	doc := mustParse(t, `{
	  "version": 1,
	  "rules": [
	    {"id": "fill-low", "priority": 50,
	     "when": {"all": [
	       {"ctx": "row_type", "op": "eq", "value": "detail"},
	       {"ctx": "seq_in_group", "mod": 2, "op": "eq", "value": 0}]},
	     "style": {"fill": {"color": "#EEEEEE"}}},
	    {"id": "fill-high", "priority": 100,
	     "when": {"ctx": "seq_in_group", "op": "eq", "value": 2},
	     "style": {"fill": {"color": "#F5F7FA"}, "bold": true}}
	  ]
	}`)
	e := NewEngine(doc)
	st, hits, err := e.Resolve(&CellContext{RowType: RowDetail, SeqInGroup: 2})
	if err != nil {
		t.Fatal(err)
	}
	if st.Fill != "#F5F7FA" || !st.Bold {
		t.Fatalf("higher priority should win: %+v", st)
	}
	if len(hits) != 2 || hits[0] != "fill-low" || hits[1] != "fill-high" {
		t.Fatalf("hits = %v", hits)
	}
}

func TestResolveBordersPerSide(t *testing.T) {
	doc := mustParse(t, `{"version":1,"rules":[
	  {"id":"b","priority":1,
	   "when":{"ctx":"row_type","op":"eq","value":"detail"},
	   "style":{"border":{
	     "top":{"at":"group_first_row","style":"medium","else":"hair"},
	     "left":{"style":"medium"}}}}]}`)
	e := NewEngine(doc)
	st, _, _ := e.Resolve(&CellContext{RowType: RowDetail, GroupFirstRow: true})
	if st.BorderTop != "medium" || st.BorderLeft != "medium" {
		t.Fatalf("got %+v", st)
	}
	st2, _, _ := e.Resolve(&CellContext{RowType: RowDetail, GroupFirstRow: false})
	if st2.BorderTop != "hair" {
		t.Fatalf("else branch failed: %+v", st2)
	}
}

func TestResolveIndentExpr(t *testing.T) {
	doc := mustParse(t, `{"version":1,"rules":[
	  {"id":"i","priority":1,
	   "when":{"ctx":"col_role","op":"eq","value":"dimension"},
	   "style":{"indent":{"expr":"dim_depth"}}}]}`)
	e := NewEngine(doc)
	st, _, _ := e.Resolve(&CellContext{ColRole: ColDimension, DimDepth: 2})
	if st.Indent != 2 {
		t.Fatalf("indent = %d", st.Indent)
	}
}

func TestResolveNoRules(t *testing.T) {
	e := NewEngine(&RulesDoc{})
	st, hits, err := e.Resolve(&CellContext{})
	if err != nil || st != (ResolvedStyle{}) || len(hits) != 0 {
		t.Fatalf("st=%+v hits=%v err=%v", st, hits, err)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/style/ -v -run TestResolve`
Expected: 编译失败（Engine/ResolvedStyle 未定义）。

- [ ] **Step 3: 实现 `internal/style/engine.go`**

```go
package style

import (
	"fmt"
	"sort"
)

// ResolvedStyle 是规则求值后的布局样式结果。
// 可比较（无 slice 字段），可直接作为字典键。
type ResolvedStyle struct {
	BorderTop    string
	BorderRight  string
	BorderBottom string
	BorderLeft   string
	Fill         string
	FontColor    string
	Bold         bool
	RowHeight    float64
	Indent       int
}

type Engine struct {
	rules []Rule // 按 priority 升序
}

func NewEngine(doc *RulesDoc) *Engine {
	rules := append([]Rule(nil), doc.Rules...)
	sort.SliceStable(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})
	return &Engine{rules: rules}
}

// Resolve 按优先级升序叠加全部命中规则，返回合并结果与命中规则 ID 列表。
func (e *Engine) Resolve(ctx *CellContext) (ResolvedStyle, []string, error) {
	var out ResolvedStyle
	var hits []string
	for _, r := range e.rules {
		ok, err := r.When.Eval(ctx)
		if err != nil {
			return out, nil, fmt.Errorf("rule %s: %w", r.ID, err)
		}
		if !ok {
			continue
		}
		applySpec(&out, &r.Style, ctx)
		hits = append(hits, r.ID)
	}
	return out, hits, nil
}

func applySpec(out *ResolvedStyle, s *StyleSpec, ctx *CellContext) {
	if s.Border != nil {
		if s.Border.Top != nil {
			out.BorderTop = s.Border.Top.Resolve(ctx)
		}
		if s.Border.Bottom != nil {
			out.BorderBottom = s.Border.Bottom.Resolve(ctx)
		}
		if s.Border.Left != nil {
			out.BorderLeft = s.Border.Left.Resolve(ctx)
		}
		if s.Border.Right != nil {
			out.BorderRight = s.Border.Right.Resolve(ctx)
		}
	}
	if s.Fill != nil {
		out.Fill = s.Fill.Color
	}
	if s.FontColor != "" {
		out.FontColor = s.FontColor
	}
	if s.Bold {
		out.Bold = true
	}
	if s.RowHeight > 0 {
		out.RowHeight = s.RowHeight
	}
	if s.Indent != nil {
		if s.Indent.Expr == "dim_depth" && ctx.DimDepth >= 0 {
			out.Indent = ctx.DimDepth
		} else {
			out.Indent = s.Indent.Value
		}
	}
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/style/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/style && git commit -m "feat(style): rule engine with priority merge and style interning key"
```

### Task 7: engine 包 —— Aggregator 增量聚合

**Files:**
- Create: `internal/engine/aggregator.go`
- Test: `internal/engine/aggregator_test.go`

- [ ] **Step 1: 写失败测试 `internal/engine/aggregator_test.go`**

```go
package engine

import (
	"math"
	"testing"

	"dynamic-report/internal/model"
)

func feed(a *Aggregator, vs ...any) {
	for _, v := range vs {
		a.Update(v)
	}
}

func TestAggSum(t *testing.T) {
	a := NewAggregator(model.AggSum)
	feed(a, 1.5, 2.5, "3") // 字符串数字也参与
	if got := a.Value().(float64); math.Abs(got-7) > 1e-9 {
		t.Fatalf("sum = %v", got)
	}
}

func TestAggSumEmpty(t *testing.T) {
	a := NewAggregator(model.AggSum)
	if got := a.Value().(float64); got != 0 {
		t.Fatalf("empty sum = %v", got)
	}
}

func TestAggAvg(t *testing.T) {
	a := NewAggregator(model.AggAvg)
	feed(a, 10, 20, 30)
	if got := a.Value().(float64); got != 20 {
		t.Fatalf("avg = %v", got)
	}
}

func TestAggCount(t *testing.T) {
	a := NewAggregator(model.AggCount)
	feed(a, 1, "x", nil, 3) // nil 不计数
	if got := a.Value().(float64); got != 3 {
		t.Fatalf("count = %v", got)
	}
}

func TestAggMinMax(t *testing.T) {
	mx := NewAggregator(model.AggMax)
	mn := NewAggregator(model.AggMin)
	feed(mx, 5, 9, 3)
	feed(mn, 5, 9, 3)
	if mx.Value().(float64) != 9 || mn.Value().(float64) != 3 {
		t.Fatalf("max=%v min=%v", mx.Value(), mn.Value())
	}
	empty := NewAggregator(model.AggMax)
	if empty.Value() != nil {
		t.Fatal("empty max should be nil")
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/engine/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/engine/aggregator.go`**

```go
package engine

import (
	"math"
	"strconv"

	"dynamic-report/internal/model"
)

// Aggregator 是单指标增量聚合器，为公式单元格提供缓存值。
type Aggregator struct {
	fn    model.AggFunc
	sum   float64
	count int64
	min   float64
	max   float64
	empty bool
}

func NewAggregator(fn model.AggFunc) *Aggregator {
	return &Aggregator{fn: fn, min: math.Inf(1), max: math.Inf(-1), empty: true}
}

func (a *Aggregator) Update(v any) {
	if v == nil {
		return
	}
	if a.fn == model.AggCount {
		a.count++
		return
	}
	f, ok := toFloat(v)
	if !ok {
		return
	}
	a.sum += f
	a.count++
	if f < a.min {
		a.min = f
	}
	if f > a.max {
		a.max = f
	}
	a.empty = false
}

func (a *Aggregator) Value() any {
	switch a.fn {
	case model.AggSum:
		if a.empty {
			return 0.0
		}
		return a.sum
	case model.AggCount:
		return float64(a.count)
	case model.AggAvg:
		if a.count == 0 {
			return 0.0
		}
		return a.sum / float64(a.count)
	case model.AggMax:
		if a.empty {
			return nil
		}
		return a.max
	case model.AggMin:
		if a.empty {
			return nil
		}
		return a.min
	}
	return nil
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	}
	return 0, false
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/engine/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/engine && git commit -m "feat(engine): incremental aggregators for SUM/AVG/COUNT/MIN/MAX"
```

---

### Task 8: engine 包 —— GroupStack 与布局物化

**Files:**
- Create: `internal/engine/layout.go`（布局类型）
- Create: `internal/engine/groupstack.go`
- Test: `internal/engine/groupstack_test.go`

- [ ] **Step 1: 实现布局类型 `internal/engine/layout.go`（先建类型，供测试编译）**

```go
package engine

import "dynamic-report/internal/style"

// DetailRow 是一条明细行：维度键按定义顺序 + 指标值。
type DetailRow struct {
	Keys   []string
	Values map[string]any
}

// SubRange 用布局行下标（0-based，含两端）记录公式引用区间，
// 物理行号由装配遍换算，保证总计置顶等重排场景下公式仍正确。
type SubRange struct {
	FromIdx, ToIdx int
}

type LayoutCell struct {
	Value     any
	DimDepth  int // >=0 维度列；-1 指标列
	MetricIdx int // >=0 指标列；-1 维度列
	SubRange  SubRange
	HasRange  bool
	Formula   string
	StyleID   string
	RuleHits  []string
}

type LayoutRow struct {
	Type       style.RowType
	Level      int // subtotal 的维度层级；其他 -1
	GroupPath  []string
	SeqInGroup int
	Cells      []LayoutCell
	Height     float64
	// P1 位置遍写入：按维度深度的首/末行标志
	FirstOfDepth []bool
	LastOfDepth  []bool
}

type MergeRange struct {
	DimDepth    int
	FromIdx     int
	ToIdx       int
}

type Layout struct {
	Rows      []*LayoutRow
	Merges    []MergeRange
	ColWidths []float64
}
```

- [ ] **Step 2: 写失败测试 `internal/engine/groupstack_test.go`**

```go
package engine

import (
	"testing"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

func twoDimDef() *model.ReportDefinition {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		panic(err)
	}
	return def
}

func rows(gs *GroupStack, data ...DetailRow) {
	for _, r := range data {
		gs.Feed(r)
	}
	gs.Finish()
}

func TestGroupStackTwoLevel(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300.0, "qty": 3}},
		DetailRow{Keys: []string{"华北", "北京"}, Values: map[string]any{"amount": 400.0, "qty": 4}},
	)
	l := gs.Layout
	// 期望行序（10 行）：
	// 0 上海明细 1 上海明细 2 上海小计 3 杭州明细 4 杭州小计
	// 5 华东小计 6 北京明细 7 北京小计 8 华北小计 9 总计
	want := []style.RowType{
		style.RowDetail, style.RowDetail, style.RowSubtotal,
		style.RowDetail, style.RowSubtotal, style.RowSubtotal,
		style.RowDetail, style.RowSubtotal, style.RowSubtotal,
		style.RowTotal,
	}
	if len(l.Rows) != len(want) {
		t.Fatalf("rows = %d, want %d", len(l.Rows), len(want))
	}
	for i, w := range want {
		if l.Rows[i].Type != w {
			t.Fatalf("row %d type = %v, want %v", i, l.Rows[i].Type, w)
		}
	}
	// 上海小计（SUM=300，COUNT=2）
	sub := l.Rows[2]
	if sub.Level != 1 {
		t.Fatalf("上海小计 level = %d", sub.Level)
	}
	sumCell := sub.Cells[2] // 前两列是维度列
	if !sumCell.HasRange || sumCell.SubRange != (SubRange{0, 1}) {
		t.Fatalf("上海小计 range = %+v", sumCell.SubRange)
	}
	if sumCell.Value.(float64) != 300 {
		t.Fatalf("上海小计 sum = %v", sumCell.Value)
	}
	cntCell := sub.Cells[3]
	if cntCell.Value.(float64) != 2 {
		t.Fatalf("上海小计 count = %v", cntCell.Value)
	}
	// 华东小计覆盖 0..4（含嵌套小计行，靠 SUBTOTAL 去重）
	hdSub := l.Rows[5]
	if hdSub.Cells[2].SubRange != (SubRange{0, 4}) {
		t.Fatalf("华东小计 range = %+v", hdSub.Cells[2].SubRange)
	}
	if hdSub.Cells[2].Value.(float64) != 600 {
		t.Fatalf("华东小计 sum = %v", hdSub.Cells[2].Value)
	}
	// 北京小计（单行组也有小计）
	if l.Rows[7].Cells[2].SubRange != (SubRange{6, 6}) {
		t.Fatalf("北京小计 range = %+v", l.Rows[7].Cells[2].SubRange)
	}
	// 总计
	total := l.Rows[9]
	if total.Cells[2].SubRange != (SubRange{0, 8}) || total.Cells[2].Value.(float64) != 1000 {
		t.Fatalf("总计 = %+v / %v", total.Cells[2].SubRange, total.Cells[2].Value)
	}
	// seq：组内逻辑序号（杭州/北京组各自重计）
	if l.Rows[0].SeqInGroup != 1 || l.Rows[1].SeqInGroup != 2 || l.Rows[3].SeqInGroup != 1 || l.Rows[6].SeqInGroup != 1 {
		t.Fatalf("seq = %d,%d,%d,%d", l.Rows[0].SeqInGroup, l.Rows[1].SeqInGroup, l.Rows[3].SeqInGroup, l.Rows[6].SeqInGroup)
	}
}

func TestGroupStackZeroDim(t *testing.T) {
	def := twoDimDef()
	def.Dimensions = nil
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Keys: nil, Values: map[string]any{"amount": 10.0, "qty": 1}},
		DetailRow{Keys: nil, Values: map[string]any{"amount": 20.0, "qty": 2}},
	)
	l := gs.Layout
	// 明细2 + 总计，无小计
	if len(l.Rows) != 3 || l.Rows[2].Type != style.RowTotal {
		t.Fatalf("rows = %d", len(l.Rows))
	}
	if l.Rows[0].SeqInGroup != 1 || l.Rows[1].SeqInGroup != 2 {
		t.Fatalf("seq = %d,%d", l.Rows[0].SeqInGroup, l.Rows[1].SeqInGroup)
	}
	if l.Rows[2].Cells[0].SubRange != (SubRange{0, 1}) {
		t.Fatalf("total range = %+v", l.Rows[2].Cells[0].SubRange)
	}
}

func TestGroupStackTotalTopShiftsRanges(t *testing.T) {
	def := twoDimDef()
	def.LayoutOpts.TotalPosition = "top"
	gs := NewGroupStack(def)
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
	)
	l := gs.Layout
	if l.Rows[0].Type != style.RowTotal {
		t.Fatalf("first row = %v", l.Rows[0].Type)
	}
	// 总计置顶后所有区间 +1
	if l.Rows[0].Cells[2].SubRange != (SubRange{1, 3}) {
		t.Fatalf("total range = %+v", l.Rows[0].Cells[2].SubRange)
	}
	if l.Rows[2].Cells[2].SubRange != (SubRange{1, 1}) {
		t.Fatalf("subtotal range = %+v", l.Rows[2].Cells[2].SubRange)
	}
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/engine/ -v -run TestGroupStack`
Expected: 编译失败（GroupStack 未定义）。

- [ ] **Step 4: 实现 `internal/engine/groupstack.go`**

```go
package engine

import (
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// GroupStack 消费有序明细流，滚动维护打开的分组，
// 产出物化布局行（明细/小计/总计）。
type GroupStack struct {
	def    *model.ReportDefinition
	Layout *Layout
	stack  []*groupState
	root   []*Aggregator // 全表聚合器，供总计缓存值
	seq    int
}

type groupState struct {
	depth    int
	key      string
	startIdx int // 组首行的布局下标
	aggs     []*Aggregator
}

func NewGroupStack(def *model.ReportDefinition) *GroupStack {
	return &GroupStack{
		def:    def,
		Layout: &Layout{},
		root:   newAggs(def.Metrics),
	}
}

func newAggs(ms []model.MetricDef) []*Aggregator {
	out := make([]*Aggregator, len(ms))
	for i, m := range ms {
		out[i] = NewAggregator(m.Agg)
	}
	return out
}

// Feed 处理一条有序明细行：闭合变浅的分组（自底向上弹出小计），
// 打开新分组，追加明细行。
func (g *GroupStack) Feed(r DetailRow) {
	lcp := 0
	for lcp < len(g.stack) && lcp < len(r.Keys) && g.stack[lcp].key == r.Keys[lcp] {
		lcp++
	}
	for len(g.stack) > lcp {
		g.closeTop()
	}
	for d := lcp; d < len(r.Keys); d++ {
		g.stack = append(g.stack, &groupState{
			depth:    d,
			key:      r.Keys[d],
			startIdx: len(g.Layout.Rows),
			aggs:     newAggs(g.def.Metrics),
		})
		if d == len(r.Keys)-1 {
			g.seq = 0 // 新内层组，序号重计
		}
	}
	if len(g.def.Dimensions) == 0 {
		g.seq = len(g.Layout.Rows) // 0 维度：序号 = 已输出明细数
	}
	g.seq++
	row := g.detailRow(r)
	row.SeqInGroup = g.seq
	g.Layout.Rows = append(g.Layout.Rows, row)
}

func (g *GroupStack) detailRow(r DetailRow) *LayoutRow {
	row := &LayoutRow{
		Type:      style.RowDetail,
		Level:     -1,
		GroupPath: append([]string(nil), r.Keys...),
	}
	for d := range g.def.Dimensions {
		row.Cells = append(row.Cells, LayoutCell{Value: r.Keys[d], DimDepth: d, MetricIdx: -1})
	}
	for mi, m := range g.def.Metrics {
		row.Cells = append(row.Cells, LayoutCell{Value: r.Values[m.Field], DimDepth: -1, MetricIdx: mi})
		for _, gs := range g.stack {
			gs.aggs[mi].Update(r.Values[m.Field])
		}
		g.root[mi].Update(r.Values[m.Field])
	}
	return row
}

// closeTop 弹出栈顶分组并追加其小计行；公式区间此刻已知。
func (g *GroupStack) closeTop() {
	gs := g.stack[len(g.stack)-1]
	path := make([]string, 0, gs.depth+1)
	for _, s := range g.stack {
		path = append(path, s.key)
	}
	g.stack = g.stack[:len(g.stack)-1]

	row := &LayoutRow{Type: style.RowSubtotal, Level: gs.depth, GroupPath: path}
	for d := range g.def.Dimensions {
		cell := LayoutCell{DimDepth: d, MetricIdx: -1}
		if d == gs.depth {
			cell.Value = gs.key
		} else if d < gs.depth {
			cell.Value = g.stack[d].key
		}
		row.Cells = append(row.Cells, cell)
	}
	lastIdx := len(g.Layout.Rows) - 1
	for mi := range g.def.Metrics {
		row.Cells = append(row.Cells, LayoutCell{
			DimDepth:  -1,
			MetricIdx: mi,
			Value:     gs.aggs[mi].Value(),
			SubRange:  SubRange{FromIdx: gs.startIdx, ToIdx: lastIdx},
			HasRange:  true,
		})
	}
	g.Layout.Rows = append(g.Layout.Rows, row)
}

// Finish 闭合剩余分组并追加总计行。
// 总计置顶时把总计行前移，并把全部区间下标 +1 补偿位移。
func (g *GroupStack) Finish() {
	for len(g.stack) > 0 {
		g.closeTop()
	}
	if len(g.Layout.Rows) == 0 {
		return
	}
	total := &LayoutRow{Type: style.RowTotal, Level: -1}
	for d := range g.def.Dimensions {
		cell := LayoutCell{DimDepth: d, MetricIdx: -1}
		if d == 0 {
			cell.Value = "总计"
		}
		total.Cells = append(total.Cells, cell)
	}
	lastIdx := len(g.Layout.Rows) - 1
	for mi := range g.def.Metrics {
		total.Cells = append(total.Cells, LayoutCell{
			DimDepth:  -1,
			MetricIdx: mi,
			Value:     g.root[mi].Value(),
			SubRange:  SubRange{FromIdx: 0, ToIdx: lastIdx},
			HasRange:  true,
		})
	}
	if g.def.LayoutOpts.TotalPosition == "top" {
		g.Layout.Rows = append([]*LayoutRow{total}, g.Layout.Rows...)
		for _, row := range g.Layout.Rows {
			for ci := range row.Cells {
				if row.Cells[ci].HasRange {
					row.Cells[ci].SubRange.FromIdx++
					row.Cells[ci].SubRange.ToIdx++
				}
			}
		}
		return
	}
	g.Layout.Rows = append(g.Layout.Rows, total)
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/engine/ -v`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add internal/engine && git commit -m "feat(engine): GroupStack rolling aggregation and layout materialization"
```

---

### Task 9: engine 包 —— P1 位置遍（边界/合并/列宽）

**Files:**
- Create: `internal/engine/position.go`
- Test: `internal/engine/position_test.go`

- [ ] **Step 1: 写失败测试 `internal/engine/position_test.go`**

```go
package engine

import "testing"

func buildSampleLayout(t *testing.T) *GroupStack {
	t.Helper()
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300.0, "qty": 3}},
		DetailRow{Keys: []string{"华北", "北京"}, Values: map[string]any{"amount": 400.0, "qty": 4}},
	)
	return gs
}

func TestPositionPassMergesAndFlags(t *testing.T) {
	l := buildSampleLayout(t).Layout
	PositionPass(twoDimDef(), l)
	// 行序（10 行）: 0上海明细 1上海明细 2上海小计 3杭州明细 4杭州小计
	//               5华东小计 6北京明细 7北京小计 8华北小计 9总计
	wantMerges := []MergeRange{
		{1, 0, 2}, // d1 上海组
		{1, 3, 4}, // d1 杭州组
		{0, 0, 5}, // d0 华东组
		{1, 6, 7}, // d1 北京组
		{0, 6, 8}, // d0 华北组
	}
	if len(l.Merges) != len(wantMerges) {
		t.Fatalf("merges = %+v", l.Merges)
	}
	for i, w := range wantMerges {
		if l.Merges[i] != w {
			t.Fatalf("merge[%d] = %+v, want %+v", i, l.Merges[i], w)
		}
	}
	// 首/末标志
	if !l.Rows[0].FirstOfDepth[0] || !l.Rows[0].FirstOfDepth[1] {
		t.Fatal("row0 should be first of both depths")
	}
	if !l.Rows[2].LastOfDepth[1] || l.Rows[2].LastOfDepth[0] {
		t.Fatalf("row2 LastOfDepth = %v", l.Rows[2].LastOfDepth)
	}
	if !l.Rows[4].LastOfDepth[1] {
		t.Fatal("row4 (杭州小计) should be last of depth1")
	}
	// 华东小计是 d0 组末行，但不是任何 d1 组的末行
	if !l.Rows[5].LastOfDepth[0] || l.Rows[5].LastOfDepth[1] {
		t.Fatalf("row5 LastOfDepth = %v", l.Rows[5].LastOfDepth)
	}
	if !l.Rows[8].LastOfDepth[0] {
		t.Fatal("row8 (华北小计) should be last of depth0")
	}
	// 合并后非首行维度值被清空
	if l.Rows[1].Cells[0].Value != nil {
		t.Fatal("row1 dim0 value should be blanked (merged)")
	}
	if l.Rows[0].Cells[0].Value != "华东" {
		t.Fatalf("row0 dim0 = %v", l.Rows[0].Cells[0].Value)
	}
}

func TestPositionPassColWidths(t *testing.T) {
	l := buildSampleLayout(t).Layout
	PositionPass(twoDimDef(), l)
	if len(l.ColWidths) != 4 {
		t.Fatalf("colwidths = %v", l.ColWidths)
	}
	// 大区列：值“华东”宽 4，表头“大区”宽 4 → >= 4
	if l.ColWidths[0] < 4 {
		t.Fatalf("col0 width = %v", l.ColWidths[0])
	}
}

func TestDisplayWidthCJK(t *testing.T) {
	if got := DisplayWidth("华东A"); got != 5 {
		t.Fatalf("DisplayWidth = %d", got)
	}
}

func TestPositionPassZeroDimFlags(t *testing.T) {
	def := twoDimDef()
	def.Dimensions = nil
	gs := NewGroupStack(def)
	rows(gs, DetailRow{Values: map[string]any{"amount": 1.0, "qty": 1}},
		DetailRow{Values: map[string]any{"amount": 2.0, "qty": 2}})
	l := gs.Layout
	PositionPass(def, l)
	// 0 维度：首行 SheetFirst 语义、总计行 SheetLast 语义，通过行级字段表达
	if !l.Rows[0].GroupFirstRow() || !l.Rows[len(l.Rows)-1].GroupLastRow() {
		t.Fatal("zero-dim sheet flags wrong")
	}
}
```

注意：`GroupFirstRow()` / `GroupLastRow()` 是 `LayoutRow` 上的便捷方法（下一步实现）。

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/engine/ -v -run 'TestPosition|TestDisplay'`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/engine/position.go`**

```go
package engine

import (
	"unicode/utf8"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// GroupFirstRow/GroupLastRow 提供行级便捷标志：
// 有维度时取最内层深度；0 维度时退化为表级首/末行语义。
func (r *LayoutRow) GroupFirstRow() bool {
	if len(r.FirstOfDepth) == 0 {
		return r.sheetFirst
	}
	return r.FirstOfDepth[len(r.FirstOfDepth)-1]
}

func (r *LayoutRow) GroupLastRow() bool {
	if len(r.LastOfDepth) == 0 {
		return r.sheetLast
	}
	return r.LastOfDepth[len(r.LastOfDepth)-1]
}

// PositionPass（P1 位置遍）：
// 1) 计算每个深度组的行跨度，写 FirstOfDepth/LastOfDepth；
// 2) 跨度 >1 行生成合并区间，并清空非首行的维度值；
// 3) 统计列宽（显示宽度，CJK 计 2）。
func PositionPass(def *model.ReportDefinition, l *Layout) {
	ndim := len(def.Dimensions)
	n := len(l.Rows)
	for _, r := range l.Rows {
		if ndim > 0 {
			r.FirstOfDepth = make([]bool, ndim)
			r.LastOfDepth = make([]bool, ndim)
		}
	}
	if ndim == 0 {
		for i, r := range l.Rows {
			r.sheetFirst = i == 0
			r.sheetLast = i == n-1
		}
	}

	type span struct {
		depth int
		start int
	}
	var spans []*span
	pathOf := func(r *LayoutRow) []string {
		switch r.Type {
		case style.RowDetail:
			return r.GroupPath
		case style.RowSubtotal:
			return r.GroupPath[:r.Level+1]
		}
		return nil // total 行不属于任何组
	}
	close := func(s *span, end int) {
		for i := s.start; i <= end; i++ {
			l.Rows[i].LastOfDepth[s.depth] = true
		}
		if end > s.start {
			l.Merges = append(l.Merges, MergeRange{s.depth, s.start, end})
			for i := s.start + 1; i <= end; i++ {
				l.Rows[i].Cells[s.depth].Value = nil
			}
		}
	}
	for i, r := range l.Rows {
		path := pathOf(r)
		lcp := 0
		for lcp < len(spans) && lcp < len(path) {
			if l.Rows[spans[lcp].start].GroupPath[lcp] != path[lcp] {
				break
			}
			lcp++
		}
		for len(spans) > lcp {
			s := spans[len(spans)-1]
			spans = spans[:len(spans)-1]
			close(s, i-1) // 触发行不属于该组；组末行是其小计行
		}
		if r.Type == style.RowDetail {
			for d := lcp; d < len(path); d++ {
				spans = append(spans, &span{depth: d, start: i})
				r.FirstOfDepth[d] = true
			}
		}
	}
	for len(spans) > 0 { // 理论上 Finish 后无残留，防御性收尾
		s := spans[len(spans)-1]
		spans = spans[:len(spans)-1]
		close(s, n-1)
	}

	// 列宽统计
	ncols := ndim + len(def.Metrics)
	l.ColWidths = make([]float64, ncols)
	for c := 0; c < ncols; c++ {
		label := ""
		if c < ndim {
			label = def.Dimensions[c].Label
		} else {
			label = def.Metrics[c-ndim].Label
		}
		l.ColWidths[c] = float64(DisplayWidth(label))
	}
	for _, r := range l.Rows {
		for c := 0; c < ncols && c < len(r.Cells); c++ {
			if s, ok := r.Cells[c].Value.(string); ok {
				if w := float64(DisplayWidth(s)); w > l.ColWidths[c] {
					l.ColWidths[c] = w
				}
			}
		}
	}
}

// DisplayWidth 计算显示宽度：CJK 等全角字符计 2，其余计 1。
func DisplayWidth(s string) int {
	w := 0
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		if r >= 0x1100 && (r <= 0x115F || r == 0x2329 || r == 0x232A ||
			(r >= 0x2E80 && r <= 0xA4CF) || (r >= 0xAC00 && r <= 0xD7A3) ||
			(r >= 0xF900 && r <= 0xFAFF) || (r >= 0xFE30 && r <= 0xFE4F) ||
			(r >= 0xFF00 && r <= 0xFF60) || (r >= 0xFFE0 && r <= 0xFFE6)) {
			w += 2
		} else {
			w++
		}
	}
	return w
}
```

同时在 `internal/engine/layout.go` 的 `LayoutRow` 结构体中补充两个未导出字段：

```go
	sheetFirst bool // 0 维度时行级首行标志
	sheetLast  bool // 0 维度时行级末行标志
```

（追加到 `LayoutRow` 末尾即可。）

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/engine/ -v`
Expected: 全部 PASS。若 `TestPositionPassMergesAndFlags` 的 lcp 判定失败，检查 `pathOf` 对 subtotal 行的切片是否正确。

- [ ] **Step 5: 提交**

```bash
git add internal/engine && git commit -m "feat(engine): P1 position pass - spans, merges, flags, column widths"
```

---

### Task 10: engine 包 —— P3 装配遍（公式生成）

**Files:**
- Create: `internal/engine/assembly.go`
- Test: `internal/engine/assembly_test.go`

- [ ] **Step 1: 写失败测试 `internal/engine/assembly_test.go`**

```go
package engine

import "testing"

func TestSubtotalFormula(t *testing.T) {
	if got := SubtotalFormula("SUM", "B", 2, 5); got != "=SUBTOTAL(9,B2:B5)" {
		t.Fatalf("got %q", got)
	}
	if got := SubtotalFormula("AVG", "C", 3, 3); got != "=SUBTOTAL(1,C3:C3)" {
		t.Fatalf("got %q", got)
	}
	if got := SubtotalFormula("COUNT", "D", 2, 9); got != "=SUBTOTAL(3,D2:D9)" {
		t.Fatalf("got %q", got)
	}
}

func TestColumnName(t *testing.T) {
	cases := map[int]string{1: "A", 2: "B", 26: "Z", 27: "AA", 28: "AB"}
	for n, want := range cases {
		if got := ColumnName(n); got != want {
			t.Fatalf("ColumnName(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestAssemblyPassFillsFormulas(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}},
	)
	l := gs.Layout
	AssemblyPass(twoDimDef(), l)
	// 行序: 0明细 1明细 2上海小计 3华东小计 4总计；物理行 = idx+2
	sub := l.Rows[2].Cells[2]
	if sub.Formula != "=SUBTOTAL(9,C2:C3)" {
		t.Fatalf("上海小计 formula = %q", sub.Formula)
	}
	hd := l.Rows[3].Cells[3] // qty 是 COUNT（code 3），列 D
	if hd.Formula != "=SUBTOTAL(3,D2:D4)" {
		t.Fatalf("华东小计 qty formula = %q", hd.Formula)
	}
	total := l.Rows[4].Cells[2]
	if total.Formula != "=SUBTOTAL(9,C2:C6)" {
		t.Fatalf("总计 formula = %q", total.Formula)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/engine/ -v -run 'TestSubtotal|TestColumn|TestAssembly'`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/engine/assembly.go`**

```go
package engine

import (
	"fmt"

	"dynamic-report/internal/model"
)

// subtotalFnCodes 映射聚合函数到 Excel SUBTOTAL 函数码。
// COUNT 使用码 3（COUNTA 语义：非空计数），见设计文档 8.1。
var subtotalFnCodes = map[model.AggFunc]int{
	model.AggSum:   9,
	model.AggAvg:   1,
	model.AggCount: 3,
	model.AggMax:   4,
	model.AggMin:   5,
}

// SubtotalFormula 生成 =SUBTOTAL(code, colFrom:colTo)。
// SUBTOTAL 天然忽略区间内嵌套的 SUBTOTAL 行，多级小计不重复求值。
func SubtotalFormula(agg model.AggFunc, col string, from, to int) string {
	return fmt.Sprintf("=SUBTOTAL(%d,%s%d:%s%d)", subtotalFnCodes[agg], col, from, col, to)
}

// ColumnName 把 1-based 列号转换为 Excel 列名（1→A，27→AA）。
func ColumnName(n int) string {
	s := ""
	for n > 0 {
		n--
		s = string(rune('A'+n%26)) + s
		n /= 26
	}
	return s
}

// AssemblyPass（P3 装配遍）：把布局下标区间换算为物理行号并生成公式。
// 物理行 = 布局下标 + 2（第 1 行是表头）。总计置顶的行位移已在
// GroupStack.Finish 中通过区间 +1 补偿，此处无需特殊处理。
func AssemblyPass(def *model.ReportDefinition, l *Layout) {
	ndim := len(def.Dimensions)
	for _, row := range l.Rows {
		for ci := range row.Cells {
			cell := &row.Cells[ci]
			if !cell.HasRange {
				continue
			}
			m := def.Metrics[cell.MetricIdx]
			col := ColumnName(ndim + cell.MetricIdx + 1)
			cell.Formula = SubtotalFormula(m.Agg, col, cell.SubRange.FromIdx+2, cell.SubRange.ToIdx+2)
		}
	}
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/engine/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add internal/engine && git commit -m "feat(engine): P3 assembly pass - SUBTOTAL formula generation"
```

### Task 11: datahub 包 —— 数据源适配与排序

**Files:**
- Create: `internal/datahub/source.go`
- Test: `internal/datahub/source_test.go`
- Create: `internal/datahub/testdata/sales.csv`

- [ ] **Step 1: 写夹具 `internal/datahub/testdata/sales.csv`**

```csv
region,region_order,city,amount,qty
华北,2,北京,400,4
华东,1,上海,100,1
华东,1,杭州,300,3
华东,1,上海,200,2
```

（故意乱序：排序必须把 region 按 region_order 升序排成 华东→华北。）

- [ ] **Step 2: 写失败测试 `internal/datahub/source_test.go`**

```go
package datahub

import (
	"reflect"
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
		t.Fatal(err)
	}
	// region 按 region_order asc：华东(1) 三行在前，华北(2) 一行在后
	gotKeys := make([]string, len(rows))
	for i, r := range rows {
		gotKeys[i] = r.Keys[0]
	}
	want := []string{"华东", "华东", "华东", "华北"}
	if !reflect.DeepEqual(gotKeys, want) {
		t.Fatalf("keys = %v", gotKeys)
	}
	// 数值字段解析为 float64
	if v, ok := rows[0].Values["amount"].(float64); !ok || v != 100 {
		t.Fatalf("amount = %v", rows[0].Values["amount"])
	}
}

func TestCSVSourceMissingColumn(t *testing.T) {
	def := testDef()
	def.Dataset.Fields = append(def.Dataset.Fields, model.FieldDef{Key: "ghost", Type: "number"})
	def.Metrics = append(def.Metrics, model.MetricDef{Field: "ghost", Label: "g", Agg: model.AggSum})
	if _, err := NewCSVSource("testdata/sales.csv").Rows(def); err == nil {
		t.Fatal("expected missing column error")
	}
}

func TestSliceSource(t *testing.T) {
	src := NewSliceSource([]map[string]any{
		{"region": "华东", "city": "上海", "amount": 1.0, "qty": 1},
		{"region": "华北", "city": "北京", "amount": 2.0, "qty": 2},
	})
	rows, err := src.Rows(testDef())
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].Keys[0] != "华东" || rows[1].Keys[0] != "华北" {
		t.Fatalf("keys = %v,%v", rows[0].Keys, rows[1].Keys)
	}
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/datahub/ -v`
Expected: 编译失败。

- [ ] **Step 4: 实现 `internal/datahub/source.go`**

```go
package datahub

import (
	"encoding/csv"
	"fmt"
	"os"
	"sort"
	"strconv"

	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
)

// Source 产出按报表定义维度排序规则排好序的明细行。
// DB 源在计划二实现（ORDER BY 下推）；本期提供 Slice 与 CSV 两种。
type Source interface {
	Rows(def *model.ReportDefinition) ([]engine.DetailRow, error)
}

type SliceSource struct{ data []map[string]any }

func NewSliceSource(data []map[string]any) *SliceSource { return &SliceSource{data: data} }

func (s *SliceSource) Rows(def *model.ReportDefinition) ([]engine.DetailRow, error) {
	rows := make([]engine.DetailRow, 0, len(s.data))
	for _, raw := range s.data {
		rows = append(rows, toDetailRow(def, raw))
	}
	sortRows(def, rows)
	return rows, nil
}

type CSVSource struct{ path string }

func NewCSVSource(path string) *CSVSource { return &CSVSource{path: path} }

func (s *CSVSource) Rows(def *model.ReportDefinition) ([]engine.DetailRow, error) {
	f, err := os.Open(s.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	records, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	colIdx := map[string]int{}
	for i, h := range records[0] {
		colIdx[h] = i
	}
	numTypes := map[string]bool{}
	for _, fd := range def.Dataset.Fields {
		if fd.Type == "number" {
			numTypes[fd.Key] = true
		}
	}
	var rows []engine.DetailRow
	for _, rec := range records[1:] {
		raw := map[string]any{}
		for key, idx := range colIdx {
			if idx >= len(rec) {
				continue
			}
			if numTypes[key] {
				f, err := strconv.ParseFloat(rec[idx], 64)
				if err != nil {
					return nil, fmt.Errorf("csv: column %s value %q is not a number", key, rec[idx])
				}
				raw[key] = f
			} else {
				raw[key] = rec[idx]
			}
		}
		rows = append(rows, toDetailRow(def, raw))
	}
	// 缺失列校验
	for _, fd := range def.Dataset.Fields {
		if _, ok := colIdx[fd.Key]; !ok {
			if fd.SortKey != "" {
				if _, ok2 := colIdx[fd.SortKey]; !ok2 {
					return nil, fmt.Errorf("csv: missing column %q (and sort_key %q)", fd.Key, fd.SortKey)
				}
				continue
			}
			return nil, fmt.Errorf("csv: missing column %q", fd.Key)
		}
	}
	sortRows(def, rows)
	return rows, nil
}

func toDetailRow(def *model.ReportDefinition, raw map[string]any) engine.DetailRow {
	keys := make([]string, len(def.Dimensions))
	for d, dim := range def.Dimensions {
		if v, ok := raw[dim.Field].(string); ok {
			keys[d] = v
		}
	}
	return engine.DetailRow{Keys: keys, Values: raw}
}

// sortRows 按维度排序规则稳定排序。
// sort.by=sort_key 时使用行内 sort_key 列的值（字符串比较，
// 数字顺序要求元数据列补零或由上游保证）；否则用维度值本身。
func sortRows(def *model.ReportDefinition, rows []engine.DetailRow) {
	less := func(a, b engine.DetailRow) bool {
		for d, dim := range def.Dimensions {
			av, bv := sortValue(def, dim, a), sortValue(def, dim, b)
			if av == bv {
				continue
			}
			if dim.Sort.Dir == "desc" {
				return av > bv
			}
			return av < bv
		}
		return false
	}
	sort.SliceStable(rows, func(i, j int) bool { return less(rows[i], rows[j]) })
}

func sortValue(def *model.ReportDefinition, dim model.DimensionDef, r engine.DetailRow) string {
	if dim.Sort.By == "sort_key" {
		for _, fd := range def.Dataset.Fields {
			if fd.Key == dim.Field && fd.SortKey != "" {
				if v, ok := r.Values[fd.SortKey]; ok {
					return fmt.Sprint(v)
				}
			}
		}
	}
	idx := -1
	for d := range def.Dimensions {
		if def.Dimensions[d].Field == dim.Field {
			idx = d
		}
	}
	if idx >= 0 && idx < len(r.Keys) {
		return r.Keys[idx]
	}
	return ""
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/datahub/ -v`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add internal/datahub && git commit -m "feat(datahub): slice and csv sources with sort_key driven ordering"
```

---

### Task 12: schema 包 —— RenderSchema 构建

**Files:**
- Create: `internal/schema/schema.go`
- Test: `internal/schema/schema_test.go`

- [ ] **Step 1: 写失败测试 `internal/schema/schema_test.go`**

```go
package schema

import (
	"encoding/json"
	"testing"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

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
	// 合并转物理坐标：上海组 布局0..2 → 物理 2..4，列 2（city）
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
	// zebra 命中行：seq=2 的明细行（上海第 2 行，物理行 3）
	zebra := s.Rows[2]
	if zebra.Seq != 2 {
		t.Fatalf("expected seq2 row at idx3, got seq=%d", zebra.Seq)
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd dynamic-report && go test ./internal/schema/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/schema/schema.go`**

```go
package schema

import (
	"fmt"
	"strconv"
	"strings"

	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

const SchemaVersion = 1

type ReportInfo struct {
	ID         string `json:"id"`
	DefVersion int    `json:"def_version"`
	RowTotal   int    `json:"row_total"`
}

type ColInfo struct {
	Idx    int     `json:"idx"`
	Role   string  `json:"role"` // dimension | metric
	Label  string  `json:"label"`
	Width  float64 `json:"width"`
	Align  string  `json:"align"`
	NumFmt string  `json:"num_fmt,omitempty"`
}

type MergeInfo struct {
	R1, R2, C int `json:"r1"`
}

type CellDTO struct {
	Col      int      `json:"col"`
	CellID   string   `json:"cell_id"`
	Value    any      `json:"value"`
	Display  string   `json:"display"`
	Formula  string   `json:"formula,omitempty"`
	Style    string   `json:"style"`
	RuleHits []string `json:"rule_hits,omitempty"`
}

type RowDTO struct {
	Idx       int       `json:"idx"` // 物理行号（1-based）
	Type      string    `json:"type"`
	GroupPath []string  `json:"group_path,omitempty"`
	Seq       int       `json:"seq,omitempty"`
	Height    float64   `json:"height,omitempty"`
	Cells     []CellDTO `json:"cells"`
}

type RenderSchema struct {
	SchemaVersion int                          `json:"schema_version"`
	Report        ReportInfo                   `json:"report"`
	Cols          []ColInfo                    `json:"cols"`
	Styles        map[string]style.ResolvedStyle `json:"styles"`
	Merges        []MergeInfo                  `json:"merges"`
	Rows          []RowDTO                     `json:"rows"`
}

// Build 从物化布局构建 RenderSchema（设计文档第 11 节）。
// trace=true 时输出 RuleHits（预览模式）。
func Build(def *model.ReportDefinition, l *engine.Layout, se *style.Engine, trace bool) (*RenderSchema, error) {
	ndim := len(def.Dimensions)
	ncols := ndim + len(def.Metrics)

	s := &RenderSchema{
		SchemaVersion: SchemaVersion,
		Report:        ReportInfo{ID: def.ID, DefVersion: def.Version, RowTotal: len(l.Rows)},
		Styles:        map[string]style.ResolvedStyle{},
	}
	dict := map[style.ResolvedStyle]string{}
	intern := func(st style.ResolvedStyle) string {
		if id, ok := dict[st]; ok {
			return id
		}
		id := fmt.Sprintf("s%d", len(dict)+1)
		dict[st] = id
		s.Styles[id] = st
		return id
	}

	for c := 0; c < ncols; c++ {
		info := ColInfo{Idx: c}
		if c < ndim {
			info.Role = "dimension"
			info.Label = def.Dimensions[c].Label
			info.Align = "left"
		} else {
			m := def.Metrics[c-ndim]
			info.Role = "metric"
			info.Label = m.Label
			info.Align = "right"
			info.NumFmt = def.BaseStyles.NumFormats[m.NumFmtRef]
		}
		w := float64(10)
		if c < len(l.ColWidths) {
			w = l.ColWidths[c] + 2
		}
		if w < 8 {
			w = 8
		}
		if w > 40 {
			w = 40
		}
		info.Width = w
		s.Cols = append(s.Cols, info)
	}
	for _, m := range l.Merges {
		s.Merges = append(s.Merges, MergeInfo{R1: m.FromIdx + 2, R2: m.ToIdx + 2, C: m.DimDepth + 1})
	}

	headerID := intern(style.ResolvedStyle{Bold: def.BaseStyles.HeaderFont.Bold})
	header := RowDTO{Idx: 1, Type: "header"}
	for c := 0; c < ncols; c++ {
		header.Cells = append(header.Cells, CellDTO{
			Col: c, CellID: fmt.Sprintf("r1c%d", c),
			Value: s.Cols[c].Label, Display: s.Cols[c].Label, Style: headerID,
		})
	}
	s.Rows = append(s.Rows, header)

	lastBodyIdx := len(l.Rows) + 1
	for i, row := range l.Rows {
		physRow := i + 2
		dto := RowDTO{
			Idx: physRow, Type: row.Type.String(),
			GroupPath: row.GroupPath, Seq: row.SeqInGroup, Height: row.Height,
		}
		for c := 0; c < ncols && c < len(row.Cells); c++ {
			cell := row.Cells[c]
			ctx := buildCtx(def, row, physRow, c, lastBodyIdx)
			st, hits, err := se.Resolve(&ctx)
			if err != nil {
				return nil, err
			}
			numFmt := ""
			if cell.MetricIdx >= 0 {
				numFmt = def.BaseStyles.NumFormats[def.Metrics[cell.MetricIdx].NumFmtRef]
			}
			dto.Cells = append(dto.Cells, CellDTO{
				Col:      c,
				CellID:   fmt.Sprintf("r%dc%d", physRow, c),
				Value:    cell.Value,
				Display:  FormatDisplay(cell.Value, numFmt),
				Formula:  cell.Formula,
				Style:    intern(st),
				RuleHits: onlyIf(trace, hits),
			})
		}
		s.Rows = append(s.Rows, dto)
	}
	return s, nil
}

func onlyIf(trace bool, hits []string) []string {
	if trace {
		return hits
	}
	return nil
}

func buildCtx(def *model.ReportDefinition, row *engine.LayoutRow, physRow, col, lastBodyIdx int) style.CellContext {
	ndim := len(def.Dimensions)
	cell := row.Cells[col]
	ctx := style.CellContext{
		Row: physRow, Col: col, RowType: row.Type,
		GroupPath: row.GroupPath, SeqInGroup: row.SeqInGroup,
		Value:         cell.Value,
		GroupFirstCol: col == 0,
		GroupLastCol:  col == ndim+len(def.Metrics)-1,
		SheetFirstRow: physRow == 2,
		SheetLastRow:  physRow == lastBodyIdx,
	}
	if cell.DimDepth >= 0 {
		ctx.ColRole = style.ColDimension
		ctx.DimDepth = cell.DimDepth
		ctx.GroupFirstRow = cell.DimDepth < len(row.FirstOfDepth) && row.FirstOfDepth[cell.DimDepth]
		ctx.GroupLastRow = cell.DimDepth < len(row.LastOfDepth) && row.LastOfDepth[cell.DimDepth]
	} else {
		ctx.ColRole = style.ColMetric
		ctx.DimDepth = -1
		ctx.MetricKey = def.Metrics[cell.MetricIdx].Field
		ctx.GroupFirstRow = row.GroupFirstRow()
		ctx.GroupLastRow = row.GroupLastRow()
	}
	return ctx
}

// FormatDisplay 按数字格式生成显示文本；格式单一事实源在后端。
func FormatDisplay(v any, numFmt string) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprint(v)
	}
	switch numFmt {
	case "#,##0.00":
		return thousands(strconv.FormatFloat(f, 'f', 2, 64))
	case "#,##0":
		return thousands(strconv.FormatFloat(f, 'f', 0, 64))
	default:
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
}

func thousands(s string) string {
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	intPart, frac := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, frac = s[:i], s[i:]
	}
	var b strings.Builder
	for i, ch := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	out := b.String() + frac
	if neg {
		return "-" + out
	}
	return out
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	return 0, false
}
```

注意：`MergeInfo` 的 json tag 需补全为 `json:"r1"` `json:"r2"` `json:"c"`（上面为排版简写，实现时写完整）。

- [ ] **Step 4: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/schema/ -v`
Expected: 全部 PASS。若 zebra 行断言失败，先打印 `s.Rows[2]` 核对物理行与布局行的对应（布局 0 → 物理 2）。

- [ ] **Step 5: 提交**

```bash
git add internal/schema && git commit -m "feat(schema): RenderSchema builder with style dictionary and display formatting"
```

---

### Task 13: render 包 —— excelize 渲染

**Files:**
- Create: `internal/render/excel.go`
- Test: `internal/render/excel_test.go`

- [ ] **Step 1: 写失败测试 `internal/render/excel_test.go`**

```go
package render

import (
	"bytes"
	"testing"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"github.com/qax-os/excelize/v2"
)

func buildSchema(t *testing.T) (*model.ReportDefinition, []byte) {
	t.Helper()
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := pipeline.BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Render(def, s, &buf); err != nil {
		t.Fatal(err)
	}
	return def, buf.Bytes()
}

func TestRenderRoundTrip(t *testing.T) {
	_, xlsx := buildSchema(t)
	f, err := excelize.OpenReader(xlsx)
	if err != nil {
		t.Fatal(err)
	}
	// 表头
	if v, _ := f.GetCellValue("Sheet1", "A1"); v != "大区" {
		t.Fatalf("A1 = %q", v)
	}
	// 首条明细（排序后华东上海 100）
	if v, _ := f.GetCellValue("Sheet1", "A2"); v != "华东" {
		t.Fatalf("A2 = %q", v)
	}
	if v, _ := f.GetCellValue("Sheet1", "C2"); v != "100" {
		t.Fatalf("C2 = %q", v)
	}
	// 小计公式（布局行 2 上海小计 → 物理行 4，列 C）
	formula, err := f.GetCellFormula("Sheet1", "C4")
	if err != nil || formula != "=SUBTOTAL(9,C2:C3)" {
		t.Fatalf("C4 formula = %q err = %v", formula, err)
	}
	// 总计行公式（布局行 9 → 物理行 11）
	total, err := f.GetCellFormula("Sheet1", "C11")
	if err != nil || total == "" {
		t.Fatalf("total formula = %q err = %v", total, err)
	}
	// 合并：city 列上海组 2..4
	merges, err := f.GetMergeCells("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range merges {
		if m.GetStartAxis() == "B2" && m.GetEndAxis() == "B4" {
			found = true
		}
	}
	if !found {
		t.Fatalf("merges = %v", merges)
	}
	// 列宽已设置
	w, err := f.GetColWidth("Sheet1", "A")
	if err != nil || w <= 0 {
		t.Fatalf("col width = %v err = %v", w, err)
	}
}
```

注意：本测试依赖 Task 14 的 `pipeline` 包；若按任务顺序执行，先完成 Task 14 Step 1（pipeline 实现）再跑本测试，或将两任务的实现步骤视为一组执行。

- [ ] **Step 2: 实现 `internal/render/excel.go`**

```go
package render

import (
	"fmt"
	"io"

	"dynamic-report/internal/model"
	"dynamic-report/internal/schema"
	"github.com/qax-os/excelize/v2"
)

// borderStyleCodes 映射 DSL 线型到 OOXML ST_BorderStyle 数值。
var borderStyleCodes = map[string]int{
	"thin": 1, "medium": 2, "dashed": 3,
	"thick": 5, "double": 6, "hair": 7,
}

// Render 把 RenderSchema 写为 .xlsx（设计文档第 13 节）。
func Render(def *model.ReportDefinition, s *schema.RenderSchema, w io.Writer) error {
	f := excelize.NewFile()
	const sheet = "Sheet1"

	// 1) 样式字典 → excelize StyleID
	styleIDs := map[string]int{}
	for sid, st := range s.Styles {
		es, err := toExcelStyle(def, st, sid == "header")
		if err != nil {
			return fmt.Errorf("style %s: %w", sid, err)
		}
		id, err := f.NewStyle(es)
		if err != nil {
			return fmt.Errorf("style %s: %w", sid, err)
		}
		styleIDs[sid] = id
	}

	// 2) 列宽
	for _, c := range s.Cols {
		axis := engineColumnName(c.Idx + 1)
		if err := f.SetColWidth(sheet, axis, axis, c.Width); err != nil {
			return err
		}
	}

	// 3) 逐行写入：先值后公式（顺序不可颠倒）
	for _, row := range s.Rows {
		for _, cell := range row.Cells {
			ref := fmt.Sprintf("%s%d", engineColumnName(cell.Col+1), row.Idx)
			if err := f.SetCellValue(sheet, ref, cell.Value); err != nil {
				return err
			}
			if cell.Formula != "" {
				if err := f.SetCellFormula(sheet, ref, cell.Formula); err != nil {
					return err
				}
			}
			if id, ok := styleIDs[cell.Style]; ok {
				if err := f.SetCellStyle(sheet, ref, ref, id); err != nil {
					return err
				}
			}
		}
		if row.Height > 0 {
			if err := f.SetRowHeight(sheet, row.Idx, row.Height); err != nil {
				return err
			}
		}
	}

	// 4) 合并单元格
	for _, m := range s.Merges {
		if err := f.MergeCell(sheet,
			fmt.Sprintf("%s%d", engineColumnName(m.C), m.R1),
			fmt.Sprintf("%s%d", engineColumnName(m.C), m.R2)); err != nil {
			return err
		}
	}

	// 5) 冻结窗格（表头行 + 维度列）与隐藏网格线
	ndim := len(def.Dimensions)
	panes := &excelize.Panes{
		Freeze: true, YSplit: 1, XSplit: ndim,
		TopLeftCell: fmt.Sprintf("%s2", engineColumnName(ndim+1)),
		ActivePane:  "bottomRight",
	}
	if ndim == 0 {
		panes.XSplit = 0
		panes.ActivePane = "bottomLeft"
	}
	if err := f.SetPanes(sheet, panes); err != nil {
		return err
	}
	if err := f.SetSheetView(sheet, 0, &excelize.ViewOptions{ShowGridLines: ptrBool(false)}); err != nil {
		return err
	}

	return f.Write(w)
}

func toExcelStyle(def *model.ReportDefinition, st struct {
	BorderTop    string
	BorderRight  string
	BorderBottom string
	BorderLeft   string
	Fill         string
	FontColor    string
	Bold         bool
	RowHeight    float64
	Indent       int
}, isHeader bool) (*excelize.Style, error) {
	es := &excelize.Style{}
	font := def.BaseStyles.BodyFont
	if isHeader {
		font = def.BaseStyles.HeaderFont
	}
	es.Font = &excelize.Font{
		Family: font.Name, Size: font.Size,
		Bold: font.Bold || st.Bold, Color: st.FontColor,
	}
	if st.Fill != "" {
		es.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{st.Fill}}
	}
	if st.Indent > 0 {
		es.Alignment = &excelize.Alignment{Indent: st.Indent, Vertical: "center", WrapText: true}
	}
	addBorder := func(side string, code int) {
		b := excelize.Border{Style: code, Color: "#000000"}
		switch side {
		case "top":
			b.Top = 1
		case "bottom":
			b.Bottom = 1
		case "left":
			b.Left = 1
		case "right":
			b.Right = 1
		}
		es.Border = append(es.Border, b)
	}
	for _, e := range []struct {
		line, side string
	}{
		{st.BorderTop, "top"}, {st.BorderBottom, "bottom"},
		{st.BorderLeft, "left"}, {st.BorderRight, "right"},
	} {
		if e.line == "" {
			continue
		}
		code, ok := borderStyleCodes[e.line]
		if !ok {
			return nil, fmt.Errorf("unknown border line %q", e.line)
		}
		addBorder(e.side, code)
	}
	return es, nil
}

func engineColumnName(n int) string {
	s := ""
	for n > 0 {
		n--
		s = string(rune('A'+n%26)) + s
		n /= 26
	}
	return s
}

func ptrBool(b bool) *bool { return &b }
```

说明：`toExcelStyle` 的入参结构即 `style.ResolvedStyle`；为避免 render 直接依赖 style 包的结构体字面量签名变化，实现时直接写 `st style.ResolvedStyle` 并 import style 包（上面为展示字段内联，落地时以 `style.ResolvedStyle` 为准）。条件格式注入（轨道 B）与打印设置依赖 spike V1/V3 结论，放在计划二随服务化落地；本任务不实现，避免未验证 API 进入关键路径。

- [ ] **Step 3: 运行确认通过**

Run: `cd dynamic-report && go test ./internal/render/ -v`
Expected: PASS（依赖 pipeline 包，见 Task 14）。

- [ ] **Step 4: 提交**

```bash
git add internal/render && git commit -m "feat(render): excelize writer with styles, merges, freeze and column widths"
```

---

### Task 14: pipeline 包与 CLI 端到端

**Files:**
- Create: `internal/pipeline/pipeline.go`
- Create: `cmd/reportgen/main.go`
- Create: `testdata/e2e/sales.csv`
- Create: `internal/pipeline/pipeline_test.go`

- [ ] **Step 1: 实现 `internal/pipeline/pipeline.go`**

```go
package pipeline

import (
	repengine "dynamic-report/internal/engine"
	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/schema"
	"dynamic-report/internal/style"
)

// BuildReport 执行完整管道：聚合 → 位置遍 → 装配遍 → 样式遍 → Schema。
// 导出与预览共用；预览端另传 trace 开启的变体（见 BuildReportWithTrace）。
func BuildReport(def *model.ReportDefinition, src datahub.Source) (*schema.RenderSchema, error) {
	return build(def, src, false)
}

func BuildReportWithTrace(def *model.ReportDefinition, src datahub.Source) (*schema.RenderSchema, error) {
	return build(def, src, true)
}

func build(def *model.ReportDefinition, src datahub.Source, trace bool) (*schema.RenderSchema, error) {
	rows, err := src.Rows(def)
	if err != nil {
		return nil, err
	}
	if cap := def.Dataset.RowCap; cap > 0 && len(rows) > cap {
		return nil, fmt.Errorf("row cap exceeded: %d > %d", len(rows), cap)
	}
	gs := repengine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	l := gs.Layout
	repengine.PositionPass(def, l)
	repengine.AssemblyPass(def, l)
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		return nil, err
	}
	return schema.Build(def, l, style.NewEngine(doc), trace)
}
```

（实现时补上 `"fmt"` import。）

- [ ] **Step 2: 实现 `cmd/reportgen/main.go`**

```go
package main

import (
	"flag"
	"fmt"
	"os"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/render"
)

func main() {
	defPath := flag.String("def", "", "报表定义 JSON 路径")
	dataPath := flag.String("data", "", "CSV 数据路径")
	out := flag.String("o", "report.xlsx", "输出 xlsx 路径")
	schemaOut := flag.String("schema-out", "", "可选：同时输出 RenderSchema JSON")
	flag.Parse()
	if *defPath == "" || *dataPath == "" {
		fmt.Fprintln(os.Stderr, "usage: reportgen -def def.json -data data.csv [-o out.xlsx] [-schema-out out.json]")
		os.Exit(2)
	}
	if err := run(*defPath, *dataPath, *out, *schemaOut); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(defPath, dataPath, out, schemaOut string) error {
	def, err := model.Load(defPath)
	if err != nil {
		return err
	}
	s, err := pipeline.BuildReport(def, datahub.NewCSVSource(dataPath))
	if err != nil {
		return err
	}
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := render.Render(def, s, f); err != nil {
		return err
	}
	if schemaOut != "" {
		b, err := json.MarshalIndent(s, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(schemaOut, b, 0o644); err != nil {
			return err
		}
	}
	fmt.Printf("written: %s (%d rows)\n", out, s.Report.RowTotal)
	return nil
}
```

（实现时补上 `"encoding/json"` import。）

- [ ] **Step 3: 写端到端夹具与测试**

`testdata/e2e/sales.csv`：复制 `internal/datahub/testdata/sales.csv` 内容。

`internal/pipeline/pipeline_test.go`：

```go
package pipeline

import (
	"testing"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
)

func TestBuildReportE2E(t *testing.T) {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err != nil {
		t.Fatal(err)
	}
	// 11 行 = 表头 + 4 明细 + 5 小计 + 1 总计
	if len(s.Rows) != 11 {
		t.Fatalf("rows = %d", len(s.Rows))
	}
	last := s.Rows[len(s.Rows)-1]
	if last.Type != "total" {
		t.Fatalf("last row = %s", last.Type)
	}
}

func TestBuildReportRowCapRejects(t *testing.T) {
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	def.Dataset.RowCap = 2
	if _, err := BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv")); err == nil {
		t.Fatal("expected row cap error")
	}
}
```

- [ ] **Step 4: 运行全部测试**

Run: `cd dynamic-report && go test ./... -v`
Expected: 全部 PASS。

- [ ] **Step 5: 手工验证 CLI 产物**

```bash
cd dynamic-report && go run ./cmd/reportgen -def internal/model/testdata/valid.json \
  -data internal/datahub/testdata/sales.csv -o /tmp/smoke.xlsx -schema-out /tmp/smoke.json
```

Expected: 输出 `written: /tmp/smoke.xlsx (10 rows)`；用 excelize 或 Excel 打开，确认分组缩进、合并、小计公式。

- [ ] **Step 6: 提交**

```bash
git add internal/pipeline cmd testdata && git commit -m "feat: pipeline assembly and reportgen CLI with e2e tests"
```

---

## 完成标准（计划一）

1. `go test ./...` 全绿；`go vet ./...` 无告警。
2. `reportgen` CLI 可由"定义 JSON + CSV"导出含多级小计、合并、样式、冻结窗格的 .xlsx。
3. RenderSchema JSON 可序列化且包含样式字典、合并、公式、cell_id。
4. spike 发现文档（`spikes/FINDINGS.md`）回填完成，作为计划二条件格式/打印标题实现的输入。

## 明确不在本计划范围（见设计文档，计划二/三交付）

- HTTP API、任务队列、catalog 版本与热更新、条件格式注入、打印设置
- 语义锚定 override、样式解释/数据血缘接口
- 前端管理端全部能力

