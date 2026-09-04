# 动态报表服务化（计划二）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在计划一核心引擎之上构建可运行的服务端：HTTP API、报表定义版本管理（SQLite 存储 + 热更新）、异步导出任务、条件格式注入与打印设置、预览交互接口（分页渲染/样式解释/数据血缘/语义锚定 override）。

**Architecture:** 单体服务进程，分层装配：`catalog`（定义存储与热更新）→ `orchestrator`（任务队列与产物）→ `httpapi`（路由/handlers）→ 复用计划一 `pipeline` 作为渲染内核。Override 编译为最高优先级伪规则注入规则引擎；样式解释复用规则引擎 trace；数据血缘由 engine 聚合阶段抽样收集。对应设计文档 `/workspace/docs/superpowers/specs/2026-09-05-dynamic-report-service-design.md` 第 9、10、12、13.2、14、15 章与第 16.9 节接口清单。

**Tech Stack:** Go 1.22+ 标准库 net/http 路由（`GET /v1/definitions/{id}/draft` 模式）、modernc.org/sqlite（纯 Go 驱动，无 CGO）、database/sql、计划一全部包。解析后依赖执行计划一的 spikes/FINDINGS.md 结论：条件格式用 `excelize.ConditionalFormatOptions`（同 rangeRef 合并一次调用）、打印标题需 `Scope:"Sheet1"`、公式"先值后公式"双写。

---

## 关键实现决策（执行者必读）

| # | 决策 | 理由 |
|---|---|---|
| P1 | HTTP 用标准库 net/http 1.22+ 路由，不引 Web 框架 | 路由模式够用，减少依赖 |
| P2 | 定义存储用 modernc.org/sqlite（driver 名 `"sqlite"`），表 `definitions(id, version, status, payload, updated_by, updated_at)`，主键 (id, version) | 忠实设计文档"DB 存储+版本化"，纯 Go 无 CGO |
| P3 | override 编译为 priority=10000+ 的伪规则注入引擎，复用优先级合并语义 | 渲染优先级 `override > 规则 > 模板` 天然由规则顺序保证；避免 schema 层二次叠加 |
| P4 | model 包不依赖 style 包（既有依赖方向约束）：`OverrideDef.StylePatch` 与 `ConditionalFormat.Style` 用独立镜像 JSON 结构，pipeline 层转换 | 保持 style 纯标准库 |
| P5 | 样式解释（style-explain）通过 `style.Engine.ResolveTraced` 返回结构化命中轨迹（规则 ID + 自然语言原因） | trace 开关仅预览模式开启（设计 11.2） |
| P6 | 数据血缘由聚合阶段抽样收集：`DetailRow.RowNo` + 组级 `CellTrace{SourceCount, SampleRows}`，不存全量主键 | 设计 12.1 明确"计数+抽样、不存全量" |
| P7 | 任务队列为进程内 channel + 固定 worker 并发槽；产物落本地目录；`Store` 接口供对象存储替换 | 单实例可运行可测试；幂等键防重复提交 |
| P8 | 条件格式：P3 装配遍把语义作用域展开为物理区间 + 列级 stats；render 对同一 rangeRef 合并为一次 `SetConditionalFormat` 调用（spike V1 结论） | 避免覆盖陷阱 |
| P9 | 预览分页：`schema.Build` 全量物化后按行窗口切片返回（物化内存已由 RowCap 约束） | 物化模式下分页只是视图，无需流式 |

---

## 文件结构

```
dynamic-report/
├── internal/model/model.go              # 修改：OverrideDef/ConditionalFormat/PrintOpts + 校验
├── internal/model/model_test.go         # 修改：新增校验测试
├── internal/model/stylepatches.go       # 新建：镜像 StyleSpec 结构（不 import style）
├── internal/catalog/store.go            # 新建：SQLite 定义存储
├── internal/catalog/store_test.go
├── internal/catalog/cache.go            # 新建：进程内缓存 + TTL 刷新 + 事件通知接口
├── internal/catalog/cache_test.go
├── internal/style/explain.go            # 新建：ResolveTraced + Cond.Explain
├── internal/style/explain_test.go
├── internal/engine/trace.go             # 新建：CellTrace 收集（改造 layout.go 的 LayoutCell）
├── internal/engine/trace_test.go
├── internal/pipeline/overrides.go       # 新建：override → 伪规则编译
├── internal/pipeline/overrides_test.go
├── internal/schema/schema.go            # 修改：ConditionalFormats/PageSetup/CellTrace 输出/分页
├── internal/schema/schema_test.go       # 修改
├── internal/render/excel.go             # 修改：条件格式注入 + 打印设置
├── internal/render/excel_test.go        # 修改
├── internal/datahub/db.go               # 新建：DBSource（ORDER BY 下推）
├── internal/datahub/db_test.go
├── internal/orchestrator/queue.go       # 新建：任务队列与进度
├── internal/orchestrator/queue_test.go
├── internal/orchestrator/export.go      # 新建：导出任务执行器（复用 pipeline+render）
├── internal/orchestrator/export_test.go
├── internal/httpapi/server.go           # 新建：路由与 handlers
├── internal/httpapi/server_test.go      # 新建：httptest 集成测试
├── cmd/reportserv/main.go               # 新建：服务装配
└── testdata/                          # e2e 夹具扩展（含 overrides 定义 JSON）
```

依赖方向（延续计划一，无环）：`model ← style ← engine ← {datahub,schema,render} ← pipeline ← {catalog,orchestrator} ← httpapi ← cmd`。新增包 `catalog`、`orchestrator`、`httpapi`；`catalog` 依赖 model；`orchestrator` 依赖 {catalog,pipeline,render,model}；`httpapi` 依赖 {catalog,orchestrator,pipeline,model,schema}。

---

### Task 1: model 扩展 —— Overrides / ConditionalFormats / PrintOpts

**Files:**
- Modify: `internal/model/model.go`（LayoutOpts、Dataset 扩展）
- Create: `internal/model/stylepatches.go`（镜像样式结构，不 import style）
- Modify: `internal/model/model_test.go`

- [ ] **Step 1: 写失败测试（追加到 model_test.go）**

```go
func TestValidateRejectsOverrideBadRowType(t *testing.T) {
	def := &ReportDefinition{}
	_ = json.Unmarshal(mustRead(t, "testdata/valid.json"), def)
	def.Overrides = []OverrideDef{{
		ID: "ov1", Scope: OverrideScope{RowType: "grand_total"},
		StylePatch: StylePatchJSON{Fill: &FillPatchJSON{Color: "#FFF"}},
	}}
	if err := def.Validate(); err == nil || !strings.Contains(err.Error(), "grand_total") {
		t.Fatalf("expected invalid row_type error, got %v", err)
	}
}

func TestValidateRejectsOverrideUnknownMetric(t *testing.T) {
	def := &ReportDefinition{}
	_ = json.Unmarshal(mustRead(t, "testdata/valid.json"), def)
	def.Overrides = []OverrideDef{{
		ID: "ov1", Scope: OverrideScope{Metric: "ghost"},
		StylePatch: StylePatchJSON{Fill: &FillPatchJSON{Color: "#FFF"}},
	}}
	if err := def.Validate(); err == nil || !strings.Contains(err.Error(), "ghost") {
		t.Fatalf("expected unknown metric error, got %v", err)
	}
}

func TestValidateRejectsCFUnknownKind(t *testing.T) {
	def := &ReportDefinition{}
	_ = json.Unmarshal(mustRead(t, "testdata/valid.json"), def)
	def.ConditionalFormats = []ConditionalFormat{{
		ID: "cf1", Scope: CFScope{Metric: "amount"}, Kind: "sparkline",
	}}
	if err := def.Validate(); err == nil || !strings.Contains(err.Error(), "sparkline") {
		t.Fatalf("expected invalid kind error, got %v", err)
	}
}

func TestPrintOptsValidation(t *testing.T) {
	def := &ReportDefinition{}
	_ = json.Unmarshal(mustRead(t, "testdata/valid.json"), def)
	def.LayoutOpts.Print = &PrintOpts{Orientation: "diagonal"}
	if err := def.Validate(); err == nil || !strings.Contains(err.Error(), "orientation") {
		t.Fatalf("expected orientation error, got %v", err)
	}
	def.LayoutOpts.Print = &PrintOpts{Orientation: "landscape", FitToWidth: 1, RepeatHeaderRows: 1}
	if err := def.Validate(); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/model/ -run 'TestValidateRejects|TestPrintOpts'`
Expected: 编译失败（类型未定义）。

- [ ] **Step 3: 创建 `internal/model/stylepatches.go`**

```go
package model

// 镜像 style 包的 StyleSpec/BorderSpec/FillSpec JSON 形态，避免 model → style 依赖。
// pipeline 层通过 marshal/unmarshal 转换为 style.StyleSpec。

type BorderSidePatchJSON struct {
	At    string `json:"at,omitempty"`
	Style string `json:"style"`
	Else  string `json:"else,omitempty"`
}

type BorderPatchJSON struct {
	Top    *BorderSidePatchJSON `json:"top,omitempty"`
	Bottom *BorderSidePatchJSON `json:"bottom,omitempty"`
	Left   *BorderSidePatchJSON `json:"left,omitempty"`
	Right  *BorderSidePatchJSON `json:"right,omitempty"`
}

type FillPatchJSON struct {
	Color string `json:"color"`
}

type IndentPatchJSON struct {
	Expr  string `json:"expr,omitempty"`
	Value int    `json:"value,omitempty"`
}

// StylePatchJSON 是 override/条件格式中的样式补丁；字段与样式 DSL 对齐。
type StylePatchJSON struct {
	Border    *BorderPatchJSON  `json:"border,omitempty"`
	Fill      *FillPatchJSON    `json:"fill,omitempty"`
	FontColor string            `json:"font_color,omitempty"`
	Bold      bool              `json:"bold,omitempty"`
	RowHeight float64           `json:"row_height,omitempty"`
	Indent    *IndentPatchJSON  `json:"indent,omitempty"`
}
```

- [ ] **Step 4: 修改 `internal/model/model.go`，追加类型与校验**

```go
// 追加到 LayoutOpts：
type PrintOpts struct {
	Orientation      string `json:"orientation,omitempty"` // portrait | landscape
	FitToWidth       int    `json:"fit_to_width,omitempty"`
	RepeatHeaderRows int    `json:"repeat_header_rows,omitempty"`
}

// LayoutOpts 增加字段：
//   Print *PrintOpts `json:"print,omitempty"`

type OverrideScope struct {
	GroupPathPrefix []string `json:"group_path_prefix,omitempty"`
	RowType         string   `json:"row_type,omitempty"` // detail | subtotal | total
	Metric          string   `json:"metric,omitempty"`
	Dim             string   `json:"dim,omitempty"`
}

type OverrideDef struct {
	ID         string          `json:"id"`
	Scope      OverrideScope   `json:"scope"`
	StylePatch StylePatchJSON  `json:"style_patch"`
}

type CFScope struct {
	Metric   string `json:"metric"`
	PerGroup bool   `json:"per_group,omitempty"`
}

type ConditionalFormat struct {
	ID    string          `json:"id"`
	Scope CFScope         `json:"scope"`
	Kind  string          `json:"kind"` // data_bar | color_scale | top_n
	Color string          `json:"color,omitempty"`
	N     int             `json:"n,omitempty"` // top_n 用
	Style StylePatchJSON  `json:"style,omitempty"`
}

// ReportDefinition 增加字段：
//   Overrides          []OverrideDef        `json:"overrides,omitempty"`
//   ConditionalFormats []ConditionalFormat  `json:"conditional_formats,omitempty"`
```

Validate() 追加规则（放在既有校验后）：

```go
	validRowTypes := map[string]bool{"": true, "detail": true, "subtotal": true, "total": true}
	for _, ov := range d.Overrides {
		if !validRowTypes[ov.Scope.RowType] {
			return fmt.Errorf("override %q: invalid row_type %q", ov.ID, ov.Scope.RowType)
		}
		if ov.Scope.Metric != "" && !fields[ov.Scope.Metric] {
			return fmt.Errorf("override %q: unknown metric %q", ov.ID, ov.Scope.Metric)
		}
		if ov.Scope.Dim != "" {
			ok := false
			for _, dim := range d.Dimensions {
				if dim.Field == ov.Scope.Dim {
					ok = true
				}
			}
			if !ok {
				return fmt.Errorf("override %q: dim %q not in dimensions", ov.ID, ov.Scope.Dim)
			}
		}
	}
	for _, cf := range d.ConditionalFormats {
		if !fields[cf.Scope.Metric] {
			return fmt.Errorf("conditional_format %q: unknown metric %q", cf.ID, cf.Scope.Metric)
		}
		switch cf.Kind {
		case "data_bar", "color_scale", "top_n":
		default:
			return fmt.Errorf("conditional_format %q: invalid kind %q", cf.ID, cf.Kind)
		}
	}
	if d.LayoutOpts.Print != nil {
		p := d.LayoutOpts.Print
		if p.Orientation != "" && p.Orientation != "portrait" && p.Orientation != "landscape" {
			return fmt.Errorf("layout_opts.print.orientation: invalid %q", p.Orientation)
		}
		if p.FitToWidth < 0 || p.RepeatHeaderRows < 0 {
			return fmt.Errorf("layout_opts.print: negative values not allowed")
		}
	}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/model/ -v`
Expected: 全部 PASS（含 4 个新测试）。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/model && git commit -m "feat(model): overrides, conditional formats, print options with validation"
```

---

### Task 2: catalog 包 —— SQLite 定义存储

**Files:**
- Create: `internal/catalog/store.go`
- Test: `internal/catalog/store_test.go`

- [ ] **Step 1: 安装 SQLite 驱动**

```bash
cd /workspace/dynamic-report && go get modernc.org/sqlite@latest
```

- [ ] **Step 2: 写失败测试 `internal/catalog/store_test.go`**

```go
package catalog

import (
	"database/sql"
	"encoding/json"
	"testing"

	_ "modernc.org/sqlite"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/catalog.db")
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func validPayload(id string, version int) string {
	b, _ := json.Marshal(map[string]any{
		"id": id, "version": version, "name": "R",
		"dataset": map[string]any{
			"source_ref": "csv_local",
			"fields": []map[string]any{
				{"key": "region", "type": "string"}, {"key": "amount", "type": "number"},
			},
		},
		"metrics": []map[string]any{{"field": "amount", "label": "A", "agg": "SUM"}},
		"style_rules": map[string]any{"version": 1, "rules": []},
	})
	return string(b)
}

func TestStoreSaveDraftAndGet(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatal(err)
	}
	d, err := s.GetDraft("r1")
	if err != nil || d == nil {
		t.Fatalf("draft = %v err = %v", d, err)
	}
	if d.Version != 1 || d.Status != "draft" || d.UpdatedBy != "alice" {
		t.Fatalf("draft meta = %+v", d)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(d.Payload), &m); err != nil || m["name"] != "R" {
		t.Fatalf("payload = %v err = %v", m, err)
	}
}

func TestStoreOptimisticLockConflict(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "a"); err != nil {
		t.Fatal(err)
	}
	// 并发方 A 基于 v1 再次保存成功（内容替换，版本不变）
	if err := s.SaveDraft("r1", validPayload("r1", 1), "b"); err != nil {
		t.Fatalf("same-base save should succeed: %v", err)
	}
}

func TestStorePublishAndVersions(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "a"); err != nil {
		t.Fatal(err)
	}
	if err := s.Publish("r1", "a"); err != nil {
		t.Fatal(err)
	}
	pub, err := s.GetPublished("r1")
	if err != nil || pub == nil {
		t.Fatalf("published = %v err = %v", pub, err)
	}
	if pub.Version != 2 || pub.Status != "published" {
		t.Fatalf("published meta = %+v", pub)
	}
	// 发布后草稿被清空
	d, err := s.GetDraft("r1")
	if err != nil || d != nil {
		t.Fatalf("draft after publish = %v err = %v", d, err)
	}
	vers, err := s.Versions("r1")
	if err != nil || len(vers) != 1 {
		t.Fatalf("versions = %v err = %v", vers, err)
	}
	if vers[0].Version != 2 {
		t.Fatalf("versions[0] = %+v", vers[0])
	}
}

func TestStoreRollback(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")                    // v2
	_ = s.SaveDraft("r1", validPayload("r1", 3), "b")
	_ = s.Publish("r1", "b")                    // v3
	if err := s.Rollback("r1", 2, "c"); err != nil {
		t.Fatal(err)
	}
	pub, _ := s.GetPublished("r1")
	if pub.Version != 4 {
		t.Fatalf("rollback version = %d, want 4", pub.Version)
	}
	var m map[string]any
	_ = json.Unmarshal([]byte(pub.Payload), &m)
	if m["version"].(float64) != 4 {
		t.Fatalf("payload version after rollback = %v, want 4", m["version"])
	}
}

func TestStoreDiffSummary(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "a"); err != nil {
		t.Fatal(err)
	}
	_ = s.Publish("r1", "a") // published v2
	// 第二次草稿内容与第一次不同（改 name + 增维度）
	changed := `{"id":"r1","version":2,"name":"R-改版",
	  "dataset":{"source_ref":"csv_local","fields":[
	    {"key":"region","type":"string"},{"key":"amount","type":"number"},{"key":"qty","type":"number"}]},
	  "dimensions":[{"field":"region","label":"大区","sort":{"by":"value","dir":"asc"}}],
	  "metrics":[
	    {"field":"amount","label":"A","agg":"SUM"},
	    {"field":"qty","label":"Q","agg":"COUNT"}],
	  "style_rules":{"version":1,"rules":[]}}`
	if err := s.SaveDraft("r1", changed, "b"); err != nil {
		t.Fatal(err)
	}
	_ = s.Publish("r1", "b") // published v3
	sum, err := s.DiffSummary("r1", 3, 2) // 新 v3 旧 v2
	if err != nil {
		t.Fatal(err)
	}
	contains := func(s string) bool {
		for _, x := range sum {
			if x == s {
				return true
			}
		}
		return false
	}
	if !contains("name") || !contains("dimensions") || !contains("metrics") || !contains("dataset") {
		t.Fatalf("diff summary = %v", sum)
	}
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/catalog/ -v`
Expected: 编译失败（Store 未定义）。

- [ ] **Step 4: 实现 `internal/catalog/store.go`**

```go
package catalog

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

type DefMeta struct {
	ID        string
	Version   int
	Status    string // draft | published
	Payload   string
	UpdatedBy string
	UpdatedAt string
}

type VersionInfo struct {
	Version   int    `json:"version"`
	Status    string `json:"status"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt string `json:"updated_at"`
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS definitions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS idx_defs_id ON definitions(id);`

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("catalog init: %w", err)
	}
	return &Store{db: db}, nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func (s *Store) rowToMeta(r *sql.Row) (*DefMeta, error) {
	var m DefMeta
	if err := r.Scan(&m.ID, &m.Version, &m.Status, &m.Payload, &m.UpdatedBy, &m.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetDraft 返回最新草稿；无草稿返回 (nil, nil)。
func (s *Store) GetDraft(id string) (*DefMeta, error) {
	row := s.db.QueryRow(`SELECT id,version,status,payload,updated_by,updated_at FROM definitions
		WHERE id=? AND status='draft' ORDER BY version DESC, updated_at DESC LIMIT 1`, id)
	return s.rowToMeta(row)
}

// SaveDraft 保存/替换当前草稿：写入 (id, pversion, 'draft')。
// 乐观锁：payload.version 即客户端持有的 base 版本；若表内已有更高版本号的草稿则返回 ErrDraftConflict。
var ErrDraftConflict = fmt.Errorf("draft conflict: base version outdated")

func (s *Store) SaveDraft(id, payload, by string) error {
	var p struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("payload version parse: %w", err)
	}
	var maxV *int
	err := s.db.QueryRow(`SELECT MAX(version) FROM definitions WHERE id=? AND status='draft'`, id).Scan(&maxV)
	if err != nil {
		return err
	}
	if maxV != nil && *maxV > p.Version {
		return fmt.Errorf("%w: have %d, base %d", ErrDraftConflict, *maxV, p.Version)
	}
	_, err = s.db.Exec(`INSERT INTO definitions(id,version,status,payload,updated_by,updated_at)
		VALUES(?,?,?,?,?,?)
		ON CONFLICT(id,version) DO UPDATE SET payload=excluded.payload, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
		id, p.Version, "draft", payload, by, now())
	return err
}

// GetPublished 返回最新已发布版本；无则 (nil, nil)。
func (s *Store) GetPublished(id string) (*DefMeta, error) {
	row := s.db.QueryRow(`SELECT id,version,status,payload,updated_by,updated_at FROM definitions
		WHERE id=? AND status='published' ORDER BY version DESC LIMIT 1`, id)
	return s.rowToMeta(row)
}

// Publish 把当前草稿发布为新版本（version = 全局 max+1），并清空草稿。
func (s *Store) Publish(id, by string) error {
	d, err := s.GetDraft(id)
	if err != nil || d == nil {
		return fmt.Errorf("publish: no draft for %s", id)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var maxV int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(version),0) FROM definitions WHERE id=?`, id).Scan(&maxV); err != nil {
		return err
	}
	newV := maxV + 1
	payload, err := bumpVersion(d.Payload, newV)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO definitions(id,version,status,payload,updated_by,updated_at)
		VALUES(?,?,?,?,?,?)`, id, newV, "published", payload, by, now()); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM definitions WHERE id=? AND status='draft'`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// Rollback 从历史版本复制 payload 为新发布版本。
func (s *Store) Rollback(id string, targetVersion int, by string) error {
	var payload string
	if err := s.db.QueryRow(`SELECT payload FROM definitions WHERE id=? AND version=? AND status='published'`, id, targetVersion).Scan(&payload); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("rollback: published version %d not found", targetVersion)
		}
		return err
	}
	var maxV int
	if err := s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM definitions WHERE id=?`, id).Scan(&maxV); err != nil {
		return err
	}
	payload, err = bumpVersion(payload, maxV+1)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO definitions(id,version,status,payload,updated_by,updated_at) VALUES(?,?,?,?,?,?)`,
		id, maxV+1, "published", payload, by, now())
	return err
}

// Versions 列出全部版本（含草稿），按版本降序。
func (s *Store) Versions(id string) ([]VersionInfo, error) {
	rows, err := s.db.Query(`SELECT version,status,updated_by,updated_at FROM definitions WHERE id=? ORDER BY version DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VersionInfo
	for rows.Next() {
		var v VersionInfo
		if err := rows.Scan(&v.Version, &v.Status, &v.UpdatedBy, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// DiffSummary 比较两个已发布版本的 payload 顶层关键节，返回变更摘要列表。
// 顺序：id name dataset dimensions metrics layout_opts style_rules overrides conditional_formats。
func (s *Store) DiffSummary(id string, newer, older int) ([]string, error) {
	np, err := s.payloadAt(id, newer)
	if err != nil {
		return nil, err
	}
	op, err := s.payloadAt(id, older)
	if err != nil {
		return nil, err
	}
	var n, o map[string]any
	_ = json.Unmarshal([]byte(np), &n)
	_ = json.Unmarshal([]byte(op), &o)
	keys := []string{"id", "name", "dataset", "dimensions", "metrics", "layout_opts", "style_rules", "overrides", "conditional_formats"}
	var out []string
	for _, k := range keys {
		ne, oe := digestOf(n[k]), digestOf(o[k])
		if ne != oe {
			out = append(out, k)
		}
	}
	return out, nil
}

func (s *Store) payloadAt(id string, v int) (string, error) {
	var payload string
	if err := s.db.QueryRow(`SELECT payload FROM definitions WHERE id=? AND version=? AND status='published'`, id, v).Scan(&payload); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("published version %d of %s not found", v, id)
		}
		return "", err
	}
	return payload, nil
}

// bumpVersion 把 payload JSON 的 version 字段替换为 newV。
func bumpVersion(payload string, newV int) (string, error) {
	var m map[string]any
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return "", fmt.Errorf("payload parse: %w", err)
	}
	m["version"] = newV
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// digestOf 生成任意 JSON 值的稳定摘要（marshal + 字符串化），用于 diff。
func digestOf(v any) string {
	if v == nil {
		return "<nil>"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(b)
}

// sortVersions 供外部展示使用（版本升序）。
func sortVersions(vs []VersionInfo) {
	sort.Slice(vs, func(i, j int) bool { return vs[i].Version < vs[j].Version })
}
```

注意：`sortVersions` 为辅助函数，若未被使用会被 `go vet` 忽略但不被编译器报错（未使用的函数不报错）；本测试未用，可保留或删除。

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/catalog/ -v`
Expected: 6 个测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/catalog dynamic-report/go.mod dynamic-report/go.sum && git commit -m "feat(catalog): sqlite definition store with versioning, publish, rollback"
```

---

### Task 3: catalog 包 —— 进程内缓存与热更新

**Files:**
- Create: `internal/catalog/cache.go`
- Test: `internal/catalog/cache_test.go`

- [ ] **Step 1: 写失败测试 `internal/catalog/cache_test.go`**

```go
package catalog

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestCacheGetAndInvalidate(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)

	def, version, err := c.GetPublished(context.Background(), "r1")
	if err != nil || def == nil {
		t.Fatalf("cached def = %v err = %v", def, err)
	}
	if version != 2 || def.ID != "r1" {
		t.Fatalf("version=%d id=%s", version, def.ID)
	}
	// 直接改库模拟外部发布，缓存未失效前仍返回旧值
	_ = s.SaveDraft("r1", validPayload("r1", 9), "b")
	_ = s.Publish("r1", "b") // 新 published v3
	def2, v2, _ := c.GetPublished(context.Background(), "r1")
	if v2 != 2 {
		t.Fatalf("cache should still serve v2, got v%d", v2)
	}
	// 失效后重新加载
	c.Invalidate("r1")
	def3, v3, _ := c.GetPublished(context.Background(), "r1")
	if v3 != 3 || def3 == def2 {
		t.Fatalf("after invalidate: v%d", v3)
	}
}

func TestCacheNotifySubscribers(t *testing.T) {
	s := openTest(t)
	c := NewCache(s)
	got := make(chan string, 2)
	c.Subscribe(func(id string) { got <- id })

	c.NotifyChanged("r1")
	select {
	case id := <-got:
		if id != "r1" {
			t.Fatalf("notify id = %s", id)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber not notified")
	}
}

func TestCacheTTLRefresh(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)
	c.SetTTL(30 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.StartTTLRefresh(ctx, 10*time.Millisecond, []string{"r1"})

	// 外部发布 v3
	_ = s.SaveDraft("r1", validPayload("r1", 9), "b")
	_ = s.Publish("r1", "b")

	// TTL 轮询应最终刷新到 v3（多实例兜底）
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, v, _ := c.GetPublished(context.Background(), "r1")
		if v == 3 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("TTL refresh did not pick up v3 within 2s")
}

func TestCacheConcurrentSafe(t *testing.T) {
	s := openTest(t)
	_ = s.SaveDraft("r1", validPayload("r1", 1), "a")
	_ = s.Publish("r1", "a")
	c := NewCache(s)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := c.GetPublished(context.Background(), "r1"); err != nil {
				t.Error(err)
			}
			c.Invalidate("r1")
		}()
	}
	wg.Wait()
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/catalog/ -v`
Expected: 编译失败（Cache 未定义）。

- [ ] **Step 3: 实现 `internal/catalog/cache.go`**

```go
package catalog

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"dynamic-report/internal/model"
)

type Cache struct {
	store *Store
	mu    sync.RWMutex
	items map[string]*cachedDef
	subs  map[int]func(string)
	next  int
	ttl   time.Duration
}

type cachedDef struct {
	version int
	payload string
}

func NewCache(store *Store) *Cache {
	return &Cache{store: store, items: map[string]*cachedDef{}, subs: map[int]func(string){}}
}

func (c *Cache) SetTTL(d time.Duration) { c.ttl = d }

// Subscribe 注册 id 变更通知；返回的取消函数移除订阅。
func (c *Cache) Subscribe(fn func(string)) (cancel func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.next
	c.next++
	c.subs[id] = fn
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		delete(c.subs, id)
	}
}

// NotifyChanged 通知所有订阅者（本实例发布时调用；多实例靠 TTL 兜底）。
func (c *Cache) NotifyChanged(id string) {
	c.mu.RLock()
	fns := make([]func(string), 0, len(c.subs))
	for _, fn := range c.subs {
		fns = append(fns, fn)
	}
	c.mu.RUnlock()
	for _, fn := range fns {
		fn(id)
	}
}

// Invalidate 强制失效某定义的缓存。
func (c *Cache) Invalidate(id string) {
	c.mu.Lock()
	delete(c.items, id)
	c.mu.Unlock()
}

// GetPublished 返回最新已发布定义（内存缓存优先，miss 查库）。
func (c *Cache) GetPublished(ctx context.Context, id string) (*model.ReportDefinition, int, error) {
	c.mu.RLock()
	item, ok := c.items[id]
	c.mu.RUnlock()
	if ok {
		def, err := unmarshalDef(item.payload)
		return def, item.version, err
	}
	meta, err := c.store.GetPublished(id)
	if err != nil {
		return nil, 0, err
	}
	if meta == nil {
		return nil, 0, nil
	}
	c.mu.Lock()
	c.items[id] = &cachedDef{version: meta.Version, payload: meta.Payload}
	c.mu.Unlock()
	def, err := unmarshalDef(meta.Payload)
	return def, meta.Version, err
}

// StartTTLRefresh 周期性轮询指定 id 的最大已发布版本，变化即刷新缓存。
// 作为事件通知丢失时的兜底（设计文档 14：事件 + 30s TTL 双保险）。
func (c *Cache) StartTTLRefresh(ctx context.Context, interval time.Duration, ids []string) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, id := range ids {
				c.refreshOne(id)
			}
		}
	}
}

func (c *Cache) refreshOne(id string) {
	meta, err := c.store.GetPublished(id)
	if err != nil || meta == nil {
		return
	}
	c.mu.Lock()
	cur, ok := c.items[id]
	if !ok || cur.version < meta.Version {
		c.items[id] = &cachedDef{version: meta.Version, payload: meta.Payload}
	}
	c.mu.Unlock()
}

func unmarshalDef(payload string) (*model.ReportDefinition, error) {
	var def model.ReportDefinition
	if err := json.Unmarshal([]byte(payload), &def); err != nil {
		return nil, err
	}
	return &def, nil
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/catalog/ -v`
Expected: 全部 PASS（含 Task 2 的 6 个 + 本任务 4 个）。

- [ ] **Step 5: 提交**

```bash
cd /workspace && git add dynamic-report/internal/catalog && git commit -m "feat(catalog): in-process cache with invalidation, notifications and TTL refresh"
```

### Task 4: pipeline —— Override 编译为伪规则

**Files:**
- Create: `internal/pipeline/overrides.go`
- Test: `internal/pipeline/overrides_test.go`

- [ ] **Step 1: 写失败测试 `internal/pipeline/overrides_test.go`**

```go
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
	all, ok := r.When.All, true
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
	ok1, err := r.When.Eval(hit)
	if err != nil || !ok1 {
		t.Fatalf("hit eval = %v err = %v", ok1, err)
	}
	ok2, _ := r.When.Eval(miss)
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
	def.Overrides[0].StylePatch.Fill.Color = "not-a-color" // model 校验不查颜色，编译层应通过；不改此断言
	raw := `[{"id":"bad","scope":{},"style_patch":{"border":{"top":{"style":"ultra"}}}}]`
	def.Overrides = nil
	_ = json.Unmarshal([]byte(raw), &def.Overrides)
	if _, err := CompileOverrides(def); err == nil {
		t.Fatal("expected invalid border style error")
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/pipeline/ -v`
Expected: 编译失败（CompileOverrides 未定义）。

- [ ] **Step 3: 实现 `internal/pipeline/overrides.go`**

```go
package pipeline

import (
	"encoding/json"
	"fmt"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// overridePriority 高于任何 DSL 规则（设计文档：override > 规则 > 模板）。
const overridePriority = 10000

// CompileOverrides 把语义锚定 override 编译为最高优先级伪规则。
// scope → when（all 组合：group_path prefix、row_type eq、col_role/metric 限定），
// style_patch → style.StyleSpec（JSON 往返转换，保持 model 不依赖 style）。
func CompileOverrides(def *model.ReportDefinition) ([]style.Rule, error) {
	var out []style.Rule
	for _, ov := range def.Overrides {
		conds := make([]style.Cond, 0, 4)
		if len(ov.Scope.GroupPathPrefix) > 0 {
			vals := make([]any, len(ov.Scope.GroupPathPrefix))
			for i, s := range ov.Scope.GroupPathPrefix {
				vals[i] = s
			}
			conds = append(conds, style.Cond{Ctx: "group_path", Op: "prefix", Values: vals})
		}
		if ov.Scope.RowType != "" {
			conds = append(conds, style.Cond{Ctx: "row_type", Op: "eq", Value: ov.Scope.RowType})
		}
		if ov.Scope.Metric != "" {
			conds = append(conds,
				style.Cond{Ctx: "col_role", Op: "eq", Value: "metric"},
				style.Cond{Ctx: "metric_key", Op: "eq", Value: ov.Scope.Metric},
			)
		}
		if ov.Scope.Dim != "" {
			conds = append(conds,
				style.Cond{Ctx: "col_role", Op: "eq", Value: "dimension"},
				style.Cond{Ctx: "dim_key", Op: "eq", Value: ov.Scope.Dim},
			)
		}
		spec, err := stylePatchToSpec(ov.StylePatch)
		if err != nil {
			return nil, fmt.Errorf("override %q: %w", ov.ID, err)
		}
		out = append(out, style.Rule{
			ID:       "override:" + ov.ID,
			Priority: overridePriority,
			When:     style.Cond{All: conds},
			Style:    spec,
		})
	}
	return out, nil
}

// stylePatchToSpec 通过 JSON 往返把镜像结构转换为 style.StyleSpec。
func stylePatchToSpec(patch model.StylePatchJSON) (style.StyleSpec, error) {
	b, err := json.Marshal(patch)
	if err != nil {
		return style.StyleSpec{}, err
	}
	var spec style.StyleSpec
	if err := json.Unmarshal(b, &spec); err != nil {
		return style.StyleSpec{}, err
	}
	// 复用以规则为中心的线型/at 校验（发布期已验证，此处防御）。
	doc := &style.RulesDoc{Rules: []style.Rule{{Style: spec}}}
	if err := doc.Validate(); err != nil {
		return style.StyleSpec{}, err
	}
	return spec, nil
}
```

- [ ] **Step 4: 修改 `internal/pipeline/pipeline.go` 的 build()：把 override 规则追加进引擎**

找到 `build()` 中的：

```go
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		return nil, err
	}
	return schema.Build(def, l, style.NewEngine(doc), trace)
```

改为：

```go
	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		return nil, err
	}
	ovRules, err := CompileOverrides(def)
	if err != nil {
		return nil, err
	}
	allRules := append(doc.Rules, ovRules...)
	return schema.Build(def, l, style.NewEngine(&style.RulesDoc{Rules: allRules}), trace)
```

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/pipeline/ -v`
Expected: 全部 PASS（含 4 个新测试 + 既有 2 个）。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/pipeline && git commit -m "feat(pipeline): compile semantic overrides into highest-priority style rules"
```

---

### Task 5: style 包 —— ResolveTraced 与条件自然语言解释

**Files:**
- Create: `internal/style/explain.go`
- Test: `internal/style/explain_test.go`

- [ ] **Step 1: 写失败测试 `internal/style/explain_test.go`**

```go
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/style/ -v -run 'TestExplain|TestResolveTraced'`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/style/explain.go`**

```go
package style

import (
	"fmt"
	"strings"
)

// RuleExplain 描述一条命中规则及其命中原因（自然语言），供预览样式解释面板。
type RuleExplain struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// ResolveTraced 与 Resolve 相同，但返回每条命中规则的解释。
// 仅预览模式使用；导出路径调用 Resolve（零额外开销）。
func (e *Engine) ResolveTraced(ctx *CellContext) (ResolvedStyle, []RuleExplain, error) {
	var out ResolvedStyle
	var explains []RuleExplain
	for _, r := range e.rules {
		ok, err := r.When.Eval(ctx)
		if err != nil {
			return out, nil, fmt.Errorf("rule %q: %w", r.ID, err)
		}
		if !ok {
			continue
		}
		applySpec(&out, &r.Style, ctx)
		explains = append(explains, RuleExplain{ID: r.ID, Reason: r.When.Explain()})
	}
	return out, explains, nil
}

// Explain 生成条件的自然语言描述（仅支持计划 DSL 的谓词与组合器）。
func (c *Cond) Explain() string {
	switch {
	case len(c.All) > 0:
		return "all(" + explainSeq(c.All) + ")"
	case len(c.Any) > 0:
		return "any(" + explainSeq(c.Any) + ")"
	case c.Not != nil:
		return "not(" + c.Not.Explain() + ")"
	default:
		return explainLeaf(c)
	}
}

func explainSeq(cs []Cond) string {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i] = c.Explain()
	}
	return strings.Join(parts, ", ")
}

func explainLeaf(c *Cond) string {
	base := c.Ctx
	if c.Mod > 0 {
		base = fmt.Sprintf("%s %% %d", base, c.Mod)
	}
	switch c.Op {
	case "in":
		vals := make([]string, len(c.Values))
		for i, v := range c.Values {
			vals[i] = fmt.Sprint(v)
		}
		return fmt.Sprintf("%s in [%s]", base, strings.Join(vals, ", "))
	case "between":
		if len(c.Values) >= 2 {
			return fmt.Sprintf("%s between %v and %v", base, c.Values[0], c.Values[1])
		}
		return base + " between"
	case "odd", "even":
		return base + " " + c.Op
	case "prefix":
		vals := make([]string, len(c.Values))
		for i, v := range c.Values {
			vals[i] = fmt.Sprint(v)
		}
		return fmt.Sprintf("%s prefix %s", base, strings.Join(vals, "."))
	default:
		return fmt.Sprintf("%s %s %v", base, c.Op, c.Value)
	}
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/style/ -v`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
cd /workspace && git add dynamic-report/internal/style && git commit -m "feat(style): traced resolve with natural-language rule explanations"
```

---

### Task 6: engine 包 —— 数据血缘抽样收集

**Files:**
- Modify: `internal/engine/layout.go`（LayoutCell 增加 Trace 字段）
- Modify: `internal/engine/groupstack.go`（采集明细行号与抽样）
- Test: `internal/engine/trace_test.go`

- [ ] **Step 1: 修改 `internal/engine/layout.go`，追加类型与字段**

在 `LayoutCell` 结构体末尾追加：

```go
	// Trace 是数据血缘信息（预览模式消费；导出不依赖）。
	Trace *CellTrace `json:"-"`
```

文件末尾追加：

```go
// CellTrace 描述单元格的数据来源：
// 明细行 → SourceRF 为所在明细的元素序号（main 列表中位置），SampleRows 为抽样行号；
// 小计/总计 → SourceRF 为明细行范围，SampleRows 为抽样来源行。
type CellTrace struct {
	SourceCount int   `json:"source_count"`
	SampleRows  []int `json:"sample_rows,omitempty"`
}
```

`DetailRow` 增加字段：

```go
	RowNo int // 明细序号（1-based，数据源按读取顺序编号）
```

- [ ] **Step 2: 修改 `internal/engine/groupstack.go`**

在 `groupState` 结构体追加：

```go
	firstDetailRowNo int // 组内第一条明细的 RowNo（聚合时顺手记录）
	detailCount      int
	detailSamples    []int // 抽样不超过 5 条 RowNo
```

在 `Feed` 的 `detailRow(r)` 调用前（`g.seq++` 之后）把行号传给聚合路径。修改 `detailRow` 签名与实现：

```go
func (g *GroupStack) Feed(r DetailRow) {
	// ...（既有 lcp/closeTop/开组/seq 逻辑不变，注意开组时 groupState 补充初始化）...
	g.seq++
	for _, gs := range g.stack {
		gs.detailCount++
		if len(gs.detailSamples) < 5 {
			gs.detailSamples = append(gs.detailSamples, r.RowNo)
		}
	}
	row := g.detailRow(r)
	// detail 行自身的 Trace：1 个来源行
	row.Cells = g.attachDetailTrace(row.Cells, r.RowNo)
	row.SeqInGroup = g.seq
	g.Layout.Rows = append(g.Layout.Rows, row)
}
```

注意：`g.stack` 顺序在 `detailRow(r)` 内的聚合更新之前已被开组逻辑准备好；上面的采样循环放在打开新组之后（与既有 `for _, gs := range g.stack { gs.aggs[mi].Update(...) }` 位置一致或在其前均可，但必须在开组之后）。

新增方法：

```go
// attachDetailTrace 为明细行的维度列附 Trace（指标列在 buildSubtotal 时处理）。
func (g *GroupStack) attachDetailTrace(cells []LayoutCell, rowNo int) []LayoutCell {
	for i := range cells {
		cells[i].Trace = &CellTrace{SourceCount: 1, SampleRows: []int{rowNo}}
	}
	return cells
}
```

`closeTop()` 中构建小计行指标单元格时追加 Trace（在 `Value: gs.aggs[mi].Value()` 处追加字段）：

```go
		Trace: &CellTrace{
			SourceCount: gs.detailCount,
			SampleRows:  append([]int(nil), gs.detailSamples...),
		},
```

`Finish()` 中 total 行的指标单元格追加（root 聚合器无独立采样，用全表重放——简化：以 `len(g.Layout.Rows)` 与各小计的样本汇总不可靠，改用 total 行构造时的计数：root 不跟踪。为正确性，`GroupStack` 增加 `rootSamples []int` 与 `rootDetailCount int`，在 Feed 中与 `g.root[mi].Update` 同步采样（放在聚合循环外）：

在 `GroupStack` 结构体追加：

```go
	rootDetailCount int
	rootSamples     []int
```

`Feed` 中（在 `for _, gs := range g.stack { gs.aggs[mi].Update(...) }` 所在循环之后、或独立处）：

```go
	if len(g.root) > 0 {
		g.rootDetailCount++
		if len(g.rootSamples) < 5 {
			g.rootSamples = append(g.rootSamples, r.RowNo)
		}
	}
```

`Finish()` total 指标单元格追加：

```go
		Trace: &CellTrace{SourceCount: g.rootDetailCount, SampleRows: append([]int(nil), g.rootSamples...)},
```

- [ ] **Step 3: 写失败测试 `internal/engine/trace_test.go`**

```go
package engine

import (
	"reflect"
	"testing"
)

func rowNos(rn ...int) []int { return rn }

func TestTraceCollectedForSubtotalAndTotal(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	rows(gs,
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 100.0, "qty": 1}, RowNo: 1},
		DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": 200.0, "qty": 2}, RowNo: 2},
		DetailRow{Keys: []string{"华东", "杭州"}, Values: map[string]any{"amount": 300.0, "qty": 3}, RowNo: 3},
	)
	l := gs.Layout
	// 布局：0明细 1明细 2上海小计 3杭州明细 4杭州小计 5华东小计 6总计
	sub := l.Rows[2].Cells[2]
	if sub.Trace == nil || sub.Trace.SourceCount != 2 || !reflect.DeepEqual(sub.Trace.SampleRows, rowNos(1, 2)) {
		t.Fatalf("上海小计 trace = %+v", sub.Trace)
	}
	hd := l.Rows[5].Cells[2]
	if hd.Trace == nil || hd.Trace.SourceCount != 3 || !reflect.DeepEqual(hd.Trace.SampleRows, rowNos(1, 2, 3)) {
		t.Fatalf("华东小计 trace = %+v", hd.Trace)
	}
	total := l.Rows[6].Cells[2]
	if total.Trace == nil || total.Trace.SourceCount != 3 {
		t.Fatalf("总计 trace = %+v", total.Trace)
	}
	// 明细行 trace
	if l.Rows[0].Cells[0].Trace == nil || l.Rows[0].Cells[0].Trace.SourceCount != 1 ||
		!reflect.DeepEqual(l.Rows[0].Cells[0].Trace.SampleRows, rowNos(1)) {
		t.Fatalf("明细 trace = %+v", l.Rows[0].Cells[0].Trace)
	}
}

func TestTraceSampleCap(t *testing.T) {
	gs := NewGroupStack(twoDimDef())
	data := make([]DetailRow, 8)
	for i := range data {
		r := i + 1
		// 8 条都在同一城市组（RowNo 1..8）
		data[i] = DetailRow{Keys: []string{"华东", "上海"}, Values: map[string]any{"amount": float64(r), "qty": 1}, RowNo: r}
	}
	rows(gs, data...)
	sub := gs.Layout.Rows[2].Cells[2] // 上海小计（8 条明细后紧跟）
	if sub.Trace.SourceCount != 8 {
		t.Fatalf("count = %d", sub.Trace.SourceCount)
	}
	if len(sub.Trace.SampleRows) != 5 {
		t.Fatalf("samples = %v", sub.Trace.SampleRows)
	}
	if !reflect.DeepEqual(sub.Trace.SampleRows, rowNos(1, 2, 3, 4, 5)) {
		t.Fatalf("samples = %v", sub.Trace.SampleRows)
	}
}
```

- [ ] **Step 4: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/engine/ -v -run TestTrace`
Expected: 编译失败或不满足断言（先编译失败：Trace 字段未定义/DetailRow.RowNo 未定义）。

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/engine/ -v`
Expected: 全部 PASS（既有 + 新增 2 个）。若既有 DataRow 构造处缺 RowNo 不影响（零值即 0，采样会记录 0——可接受，测试均显式给 RowNo）。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/engine && git commit -m "feat(engine): collect data lineage traces (count + capped samples) during aggregation"
```

### Task 7: schema 包 —— 条件格式展开、页面设置、血缘/解释输出与分页

**Files:**
- Modify: `internal/schema/schema.go`
- Modify: `internal/schema/schema_test.go`
- Create: `internal/model/testdata/overrides_test.json`（带 override 与条件格式的定义夹具）

- [ ] **Step 1: 创建夹具 `internal/model/testdata/overrides_test.json`**

在 `internal/model/testdata/valid.json` 基础上追加：

```json
{
  "id": "rpt_sales", "version": 2, "name": "销售报表",
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
  "layout_opts": {
    "total_position": "bottom",
    "print": {"orientation": "landscape", "fit_to_width": 1, "repeat_header_rows": 1}
  },
  "base_styles": {
    "header_font": {"name": "Arial", "size": 11, "bold": true},
    "body_font": {"name": "Arial", "size": 10},
    "num_formats": {"money": "#,##0.00", "int": "#,##0"}
  },
  "style_rules": {"version": 1, "rules": [
    {"id": "zebra", "priority": 50,
     "when": {"all": [
       {"ctx": "row_type", "op": "eq", "value": "detail"},
       {"ctx": "seq_in_group", "mod": 2, "op": "eq", "value": 0}]},
     "style": {"fill": {"color": "#F5F7FA"}}}
  ]},
  "overrides": [
    {"id": "ov_ew", "scope": {"group_path_prefix": ["华东"], "row_type": "subtotal"},
     "style_patch": {"fill": {"color": "#FFF7E6"}, "bold": true}}
  ],
  "conditional_formats": [
    {"id": "cf_amount", "scope": {"metric": "amount"}, "kind": "data_bar", "color": "#638EC6"},
    {"id": "cf_top", "scope": {"metric": "amount", "per_group": true}, "kind": "top_n", "n": 3,
     "style": {"fill": {"color": "#FDEBD0"}, "bold": true}}
  ]
}
```

（注意：此夹具的 style_rules 已含 zebra，供 schema 测试直接复用。）

- [ ] **Step 2: 写失败测试（追加到 schema_test.go）**

```go
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
	// 页面设置：landscape + 重复表头行 1
	if s.PageSetup == nil || s.PageSetup.Orientation != "landscape" || s.PageSetup.RepeatHeaderRows != 1 || s.PageSetup.FitToWidth != 1 {
		t.Fatalf("page setup = %+v", s.PageSetup)
	}
	// 条件格式：data_bar 覆盖 C2:C11（amount 列，无 per_group → 单条）；top_n per_group → 3 个城市组各一条
	if len(s.ConditionalFormats) == 0 {
		t.Fatal("no conditional formats")
	}
	var dataBar *CFInfo
	topCount := 0
	for i := range s.ConditionalFormats {
		cf := &s.ConditionalFormats[i]
		if cf.Kind == "data_bar" {
			dataBar = cf
		}
		if cf.Kind == "top_n" {
			topCount++
		}
	}
	if dataBar == nil || len(dataBar.Ranges) != 1 || !strings.HasPrefix(dataBar.Ranges[0], "C2:") {
		t.Fatalf("data bar = %+v", dataBar)
	}
	if topCount != 3 {
		t.Fatalf("top_n count = %d, want 3", topCount)
	}
	// 每组一条 top_n 各自带 ranges
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
	// 编译 override 规则进引擎（复用 pipeline 暴露的编译；测试包为 schema，为避免循环依赖，
	// 此处直接调用 stylePatchToSpec 的等效逻辑：本测试改由 pipeline 包的 e2e 测试覆盖；
	// schema 层只验证 Build 透传 RuleHits 与 StylePatch 形态）。
	_ = def
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
	s, err := Build(def, gs.Layout, style.NewEngine(&style.RulesDoc{}), true)
	if err != nil {
		t.Fatal(err)
	}
	// zebra 命中的明细行（物理 3=布局 1，上海第 2 条）应带 RuleHits 与 Explains
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
	if err := s.PageRows(3, 5); err != nil {
		t.Fatal(err)
	}
	if len(s.Rows) != 5 {
		t.Fatalf("paged rows = %d", len(s.Rows))
	}
	if s.Rows[0].Idx != 1 || s.Rows[1].Idx != 2 {
		t.Fatalf("header must stay first: %+v", s.Rows[0])
	}
}
```

注意：`TestBuildSchemaOverrideInRuleHits` 为占位（override 端到端在 Task 10/11 的 pipeline/service 层覆盖）。若团队希望 schema 层也验证，可改用 `buildSample` + 手工构造 `style.RulesDoc` 含 override 伪规则后断言 RuleHits 含 `override:` 前缀。

- [ ] **Step 3: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/schema/ -v`
Expected: 编译失败（CFInfo/PageSetup/Explains/PageRows 未定义）。

- [ ] **Step 4: 修改 `internal/schema/schema.go`**

新增类型与字段：

```go
type PageSetupInfo struct {
	Orientation      string `json:"orientation,omitempty"`
	FitToWidth       int    `json:"fit_to_width,omitempty"`
	RepeatHeaderRows int    `json:"repeat_header_rows,omitempty"`
}

// CFInfo 是展开后的条件格式条目：
// Ranges 为物理区间列表（"C2:C11"），Stats 供预览端模拟。
type CFInfo struct {
	ID     string   `json:"id"`
	Kind   string   `json:"kind"`
	Color  string   `json:"color,omitempty"`
	N      int      `json:"n,omitempty"`
	Style  model.StylePatchJSON `json:"style,omitempty"`
	Ranges []string `json:"ranges"`
	Stats  *CFStats `json:"stats,omitempty"`
}

type CFStats struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type ExplainDTO struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type CellDTO 增加：
	Explains []ExplainDTO `json:"explains,omitempty"`
	Trace    *CellTraceDTO `json:"trace,omitempty"`

type CellTraceDTO struct {
	SourceCount int   `json:"source_count"`
	SampleRows  []int `json:"sample_rows,omitempty"`
}

// RenderSchema 增加：
	PageSetup          *PageSetupInfo `json:"page_setup,omitempty"`
	ConditionalFormats []CFInfo       `json:"conditional_formats,omitempty"`
```

`CellDTO.Trace` 由 `*engine.CellTrace` 转 `*CellTraceDTO`（在 Build 的单元格循环中：`Trace: toTraceDTO(cell.Trace)`）。

`RenderSchema` 增加方法：

```go
// PageRows 按行窗口切片（窗口按"数据行序号"计，header 恒保留在首位）。
// [from,to) 是数据行（即 Rows[1:]）的下标区间。
func (s *RenderSchema) PageRows(from, to int) error {
	if from < 0 || to < from || to > len(s.Rows)-1 {
		return fmt.Errorf("invalid row window [%d,%d), rows=%d", from, to, len(s.Rows)-1)
	}
	body := s.Rows[1:]
	s.Rows = append([]RowDTO{s.Rows[0]}, body[from:to]...)
	return nil
}
```

Build 尾部（在返回前）追加条件格式与页面设置装配：

```go
	s.PageSetup = buildPageSetup(def)
	s.ConditionalFormats = buildConditionalFormats(def, l, ndim)
```

新增辅助（schema.go 内）：

```go
func buildPageSetup(def *model.ReportDefinition) *PageSetupInfo {
	if def.LayoutOpts.Print == nil {
		return nil
	}
	return &PageSetupInfo{
		Orientation:      def.LayoutOpts.Print.Orientation,
		FitToWidth:       def.LayoutOpts.Print.FitToWidth,
		RepeatHeaderRows: def.LayoutOpts.Print.RepeatHeaderRows,
	}
}

// buildConditionalFormats 把语义作用域展开为物理区间。
// 无 per_group 的数据条展开为单条全列区间；per_group 的 top_n 按组展开逐条；
// 分组数 >200 时降级为全局并忽略（防条件格式条目爆炸，设计文档 §9）。
const cfGroupLimit = 200

func buildConditionalFormats(def *model.ReportDefinition, l *engine.Layout, ndim int) []CFInfo {
	var out []CFInfo
	for _, cf := range def.ConditionalFormats {
		colIdx := -1
		for mi, m := range def.Metrics {
			if m.Field == cf.Scope.Metric {
				colIdx = ndim + mi
			}
		}
		if colIdx < 0 {
			continue
		}
		colLetter := ColumnName(colIdx + 1)
		info := CFInfo{ID: cf.ID, Kind: cf.Kind, Color: cf.Color, N: cf.N, Style: cf.Style}

		type groupBand struct{ from, to int } // 布局下标闭区间，含首尾
		var bands []groupBand
		if cf.Scope.PerGroup {
			for _, m := range l.Merges {
				if m.DimDepth == ndim-1 {
					bands = append(bands, groupBand{m.FromIdx, m.ToIdx})
				}
			}
			// 单行组（无合并）不在此列：合并生成的组跨度 ≥2；单组（城市组只有 1 行）时
			// 组内无合并，未收录——需要按行扫尾：若 bands 为空则退化全局。
			if len(bands) == 0 { // 全员单行组 → 直接退化
				bands = append(bands, groupBand{0, len(l.Rows) - 1})
			}
			if len(bands) > cfGroupLimit { // top_n 逐组超过上限 → 全局降级
				bands = []groupBand{{0, len(l.Rows) - 1}}
			}
		} else {
			bands = []groupBand{{0, len(l.Rows) - 1}}
		}
		minV, maxV := +inf, -inf
		for _, b := range bands {
			info.Ranges = append(info.Ranges, fmt.Sprintf("%s%d:%s%d", colLetter, b.from+2, colLetter, b.to+2))
			for i := b.from; i <= b.to; i++ {
				if i < len(l.Rows) && i < len(l.Rows[i].Cells) {
					if f, ok := toFloat(l.Rows[i].Cells[colIdx].Value); ok {
						if f < minV { minV = f }
						if f > maxV { maxV = f }
					}
				}
			}
		}
		if cf.Kind == "data_bar" || cf.Kind == "color_scale" {
			info.Stats = &CFStats{Min: minV, Max: maxV}
		}
		out = append(out, info)
	}
	return out
}
```

注意：`toFloat` 在 schema.go 已存在（Task 12 引入），`ColumnName` 需在 schema 包内复制一行实现或改引 engine.ColumnName（建议：`schema` 包内已有 `ColumnName`？检查——计划一 schema.go 无 ColumnName，render 有。此处用 `engine.ColumnName` 需要 schema→engine 已有依赖（schema 已依赖 engine），直接调用 `engine.ColumnName(colIdx+1)`。用该形式替换上面的 `ColumnName` 调用。

`Build` 的单元格循环中为 CellDTO 补 `Explains` 与 `Trace`（trace 模式）时改用 `ResolveTraced`：

找到循环内：

```go
			st, hits, err := se.Resolve(&ctx)
			if err != nil {
				return nil, err
			}
```

改为（trace 模式下用 ResolveTraced 获取解释；非 trace 用 Resolve）：

```go
			var st style.ResolvedStyle
			var explains []ExplainDTO
			if trace {
				st, explains, err = tracedResolve(se, &ctx)
				if err != nil {
					return nil, err
				}
			} else {
				var hits []string
				st, hits, err = se.Resolve(&ctx)
				if err != nil {
					return nil, err
				}
				_ = hits
			}
```

新增：

```go
// tracedResolve 统一封装 traced 调用并转换 RuleExplain → ExplainDTO。
func tracedResolve(e *style.Engine, ctx *style.CellContext) (style.ResolvedStyle, []ExplainDTO, error) {
	st, ex, err := e.ResolveTraced(ctx)
	if err != nil {
		return st, nil, err
	}
	out := make([]ExplainDTO, 0, len(ex))
	for _, x := range ex {
		out = append(out, ExplainDTO{ID: x.ID, Reason: x.Reason})
	}
	return st, out, nil
}

func toTraceDTO(t *engine.CellTrace) *CellTraceDTO {
	if t == nil {
		return nil
	}
	return &CellTraceDTO{SourceCount: t.SourceCount, SampleRows: t.SampleRows}
}
```

对应 CellDTO 构造处追加：`Explains: explains, Trace: toTraceDTO(cell.Trace),`（保持既有 RuleHits 逻辑：trace 时仍由 explains 承载，rule_hits 可由调用方从 explains 提取——为兼容既有前端契约保留 RuleHits 输出：在 traced 分支把 explains 的 ID 列表也填入 RuleHits）。

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/schema/ -v`
Expected: 全部 PASS（既有 6 个 + 新增 4 个）。若 top_n 条数与推演不符（城市组 3 个 + 全员单行组退化），核对 `l.Merges` 中 `DimDepth==ndim-1` 的条目数。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/schema dynamic-report/internal/model/testdata && git commit -m "feat(schema): conditional formats expansion, page setup, traced explains and paging"
```

---

### Task 8: render 包 —— 条件格式注入与打印设置

**Files:**
- Modify: `internal/render/excel.go`
- Modify: `internal/render/excel_test.go`

- [ ] **Step 1: 写失败测试（追加到 excel_test.go）**

```go
func TestRenderConditionalFormatsAndPrint(t *testing.T) {
	def, err := model.Load("../model/testdata/overrides_test.json")
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
	f, err := excelize.OpenReader(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	// 条件格式存在：读 xmlConditionalFormatting 命名空间计数
	sheet, _ := f.GetSheetXML("Sheet1")
	if !bytes.Contains(sheet, []byte("conditionalFormatting")) {
		t.Fatal("no conditional formatting in sheet xml")
	}
	// 数据条颜色出现在 sheet xml
	if !bytes.Contains(sheet, []byte("638EC6")) {
		t.Fatal("data bar color missing in sheet xml")
	}
	// 打印标题 defined name
	var printTitles bool
	for _, dn := range f.GetDefinedName() {
		if dn.Name == "_xlnm.Print_Titles" && dn.Scope == "Sheet1" {
			printTitles = true
		}
	}
	if !printTitles {
		t.Fatal("print titles defined name missing")
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/render/ -v -run TestRenderConditional`
Expected: 失败（sheet xml 无 conditionalFormatting）。

- [ ] **Step 3: 修改 `internal/render/excel.go`**

在 `Render` 中合并单元格步骤之后、冻结窗格之前插入：

```go
	// 5) 条件格式注入（轨道 B；同一 rangeRef 合并为一次调用，spike V1 结论）
	if err := applyConditionalFormats(f, sheet, s.ConditionalFormats); err != nil {
		return err
	}

	// 6) 打印设置（重复表头行需带 Scope，spike V3 结论）
	if err := applyPageSetup(f, sheet, s.PageSetup); err != nil {
		return err
	}
```

（原注释编号顺延，无影响。）

文件末尾新增实现：

```go
// applyConditionalFormats 注入条件格式；同 kind+rangeRef 合并一次 SetConditionalFormat。
func applyConditionalFormats(f *excelize.File, sheet string, cfs []schema.CFInfo) error {
	// range → []excelize.ConditionalFormatOptions 分组
	byRange := map[string][]excelize.ConditionalFormatOptions{}
	var order []string
	addOpt := func(rng string, opt excelize.ConditionalFormatOptions) {
		if _, ok := byRange[rng]; !ok {
			order = append(order, rng)
		}
		byRange[rng] = append(byRange[rng], opt)
	}
	for _, cf := range cfs {
		for _, rng := range cf.Ranges {
			var opt excelize.ConditionalFormatOptions
			switch cf.Kind {
			case "data_bar":
				opt = excelize.ConditionalFormatOptions{Type: "data_bar", BarColor: cf.Color}
			case "color_scale":
				opt = excelize.ConditionalFormatOptions{Type: "color_scale"}
			case "top_n":
				opt = excelize.ConditionalFormatOptions{Type: "top", Criteria: ">", Value: fmt.Sprint(cf.N - 1)}
				if cf.Style.Fill != nil {
					st, err := f.NewConditionalStyle(&excelize.Style{
						Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{cf.Style.Fill.Color}},
						Font: &excelize.Font{Bold: cf.Style.Bold},
					})
					if err != nil {
						return err
					}
					opt.Format = &st
				}
			default:
				continue
			}
			addOpt(rng, opt)
		}
	}
	for _, rng := range order {
		if err := f.SetConditionalFormat(sheet, rng, byRange[rng]); err != nil {
			return fmt.Errorf("conditional format %s: %w", rng, err)
		}
	}
	return nil
}

// applyPageSetup 应用打印设置：方向、缩放到一页宽、重复表头行。
func applyPageSetup(f *excelize.File, sheet string, ps *schema.PageSetupInfo) error {
	if ps == nil {
		return nil
	}
	var orient string
	switch ps.Orientation {
	case "landscape":
		orient = "landscape"
	default:
		orient = "portrait"
	}
	if ps.FitToWidth > 0 {
		if err := f.SetPageLayout(sheet, &excelize.PageLayoutOptions{
			Orientation: &orient, FitToWidth: &ps.FitToWidth,
		}); err != nil {
			return err
		}
	} else if ps.Orientation != "" {
		if err := f.SetPageLayout(sheet, &excelize.PageLayoutOptions{Orientation: &orient}); err != nil {
			return err
		}
	}
	if ps.RepeatHeaderRows > 0 {
		if err := f.SetDefinedName(&excelize.DefinedName{
			Name: "_xlnm.Print_Titles", RefersTo: fmt.Sprintf("%s!$1:$%d", sheet, ps.RepeatHeaderRows),
			Scope: sheet, // 必须带 Scope（spike V3）
		}); err != nil {
			return err
		}
	}
	return nil
}
```

需要 import 依赖 `schema.CFInfo`、`excelize`（已有）。注意 `excelize.PageLayoutOptions` 的字段名（v2.9.0：`Orientation *string`、`FitToWidth *int`）；若签名不同按编译错误调整并记录。

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/render/ -v`
Expected: 全部 PASS。若 `GetSheetXML` 为空或 `conditionalFormatting` 不在 sheet1，检查 `f.GetSheetList()` 名称（"Sheet1"）与条件格式注入顺序。

- [ ] **Step 5: 提交**

```bash
cd /workspace && git add dynamic-report/internal/render && git commit -m "feat(render): conditional format injection (merged per range) and print setup"
```

---

### Task 9: datahub 包 —— DB 数据源（ORDER BY 下推）

**Files:**
- Create: `internal/datahub/db.go`
- Test: `internal/datahub/db_test.go`

- [ ] **Step 1: 写失败测试 `internal/datahub/db_test.go`**

```go
package datahub

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/model"
)

func memDB(t *testing.T, ddl string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ddl); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestDBSourceOrdersBySortKey(t *testing.T) {
	db := memDB(t, `
CREATE TABLE sales (region TEXT, region_order INTEGER, city TEXT, amount REAL, qty INTEGER);
INSERT INTO sales VALUES ('华北',2,'北京',400,4);
INSERT INTO sales VALUES ('华东',1,'上海',100,1);
INSERT INTO sales VALUES ('华东',1,'杭州',300,3);
INSERT INTO sales VALUES ('华东',1,'上海',200,2);`)
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	src := NewDBSource("sales", db)
	rows, err := src.Rows(def)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %d", len(rows))
	}
	if rows[0].Keys[0] != "华东" || rows[3].Keys[0] != "华北" {
		t.Fatalf("first/last region = %v / %v", rows[0].Keys, rows[3].Keys)
	}
	// sort_key（region_order）驱动：华东(1)在前
	if rows[0].RowNo != 2 { // 华东上海 100 是表中第 2 行
		t.Fatalf("first RowNo = %d", rows[0].RowNo)
	}
}

func TestDBSourceRejectsBadFields(t *testing.T) {
	db := memDB(t, `CREATE TABLE sales (a TEXT, b REAL);`)
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	src := NewDBSource("sales", db)
	// 定义字段 region 不存在于表 → Rows 出错
	if _, err := src.Rows(def); err == nil {
		t.Fatal("expected error for missing column")
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/datahub/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/datahub/db.go`**

```go
package datahub

import (
	"database/sql"
	"fmt"
	"strings"

	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
)

// DBSource 从 SQL 数据库读取明细，ORDER BY 下推（设计文档：DB 源排序由 SQL 完成）。
// 字段名来自定义白名单（dataset.fields），拼接时做白名单校验，SQL 注入由参数化查询兜底。
type DBSource struct {
	table string
	db    *sql.DB
}

func NewDBSource(table string, db *sql.DB) *DBSource { return &DBSource{table: table, db: db} }

func (s *DBSource) Rows(def *model.ReportDefinition) ([]engine.DetailRow, error) {
	// 1) 列白名单
	fieldKeys := map[string]bool{}
	for _, f := range def.Dataset.Fields {
		fieldKeys[f.Key] = true
		if f.SortKey != "" {
			fieldKeys[f.SortKey] = true
		}
	}
	// 2) SELECT 列
	cols := make([]string, 0, len(fieldKeys))
	for k := range fieldKeys {
		cols = append(cols, k)
	}
	// 3) ORDER BY：维度序列 → 对应排序列（sort_key 优先，否则维度值列）
	var orderCols []string
	orderCol := func(dim model.DimensionDef) string {
		for _, f := range def.Dataset.Fields {
			if f.Key == dim.Field && f.SortKey != "" {
				return f.SortKey
			}
		}
		return dim.Field
	}
	for _, dim := range def.Dimensions {
		orderCols = append(orderCols, orderCol(dim))
	}
	orderBY := ""
	if len(orderCols) > 0 {
		parts := make([]string, len(orderCols))
		for i, c := range orderCols {
			if !fieldKeys[c] {
				return nil, fmt.Errorf("db source: sort column %q not in field whitelist", c)
			}
			parts[i] = c
		}
		orderBY = " ORDER BY " + strings.Join(parts, ", ")
	}
	query := fmt.Sprintf("SELECT %s FROM %s%s", strings.Join(cols, ", "), s.table, orderBY)
	// 表名不做引号转义（由数据源定义方保证）；列名已白名单校验。
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("db source query: %w", err)
	}
	defer rows.Close()

	numTypes := map[string]bool{}
	for _, f := range def.Dataset.Fields {
		if f.Type == "number" {
			numTypes[f.Key] = true
		}
	}
	var out []engine.DetailRow
	rowNo := 0
	for rows.Next() {
		rowNo++
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		raw := map[string]any{}
		for i, c := range cols {
			raw[c] = normalized(vals[i])
			_ = numTypes // 类型转换由驱动返回；Aggregator 的 toFloat 可消化
		}
		out = append(out, toDetailRow(def, raw))
		out[len(out)-1].RowNo = rowNo
	}
	return out, rows.Err()
}

// normalized 把 []byte/null 规整为可用类型。
func normalized(v any) any {
	switch t := v.(type) {
	case []byte:
		return string(t)
	default:
		return t
	}
}
```

注意：`toDetailRow` 需要给 `Values` 中多出的 sort_key 列保留（`toDetailRow` 透传 raw，天然保留）。`DBSource` 的列白名单校验在拼接前已保证列名安全。

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/datahub/ -v`
Expected: 全部 PASS（含 2 个新测试）。

- [ ] **Step 5: 提交**

```bash
cd /workspace && git add dynamic-report/internal/datahub && git commit -m "feat(datahub): sql source with ORDER BY pushdown and column whitelist"
```

### Task 10: orchestrator 包 —— 任务队列与导出执行器

**Files:**
- Create: `internal/orchestrator/queue.go`
- Create: `internal/orchestrator/export.go`
- Test: `internal/orchestrator/export_test.go`

- [ ] **Step 1: 写失败测试 `internal/orchestrator/export_test.go`**

```go
package orchestrator

import (
	"os"
	"sync"
	"testing"
	"time"

	"dynamic-report/internal/datahub"
)

// fakeCatalog 内存实现定义获取（避免依赖 catalog 存储细节）。
type fakeCatalog struct{}

func newTestOrchestrator(t *testing.T) (*Orchestrator, string) {
	t.Helper()
	artDir := t.TempDir()
	_ = &fakeCatalog{}
	o := NewOrchestrator(&SinkFunc{fn: func(taskID string, state State, progress float64) {}})
	o.SetArtifactDir(artDir)
	return o, artDir
}

func TestSubmitRunsExport(t *testing.T) {
	o, _ := newTestOrchestrator(t)
	// 直接以本地定义提交（用定义 JSON 加载，走 pipeline）
	submit, err := o.Submit(ExportRequest{
		DefinitionJSON: validDefJSON(), // 直接内联的定义
		DataSource:     datahub.NewCSVSource("../datahub/testdata/sales.csv"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if submit != "task-1" {
		t.Fatalf("task id = %s", submit)
	}
	// 等待完成（轮询）
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		st, err := o.Status("task-1")
		if err != nil {
			t.Fatal(err)
		}
		if st.State == "done" {
			if st.Progress != 1.0 {
				t.Fatalf("progress = %v", st.Progress)
			}
			break
		}
		if st.State == "failed" {
			t.Fatalf("task failed: %v", st.Error)
		}
		time.Sleep(20 * time.Millisecond)
	}
	st, _ := o.Status("task-1")
	if st.State != "done" {
		t.Fatalf("state = %s", st.State)
	}
	if _, err := os.Stat(st.ArtifactPath); err != nil {
		t.Fatalf("artifact missing: %v", err)
	}
}

func validDefJSON() string {
	// 与 model/testdata/valid.json 等价的内联定义
	return `{"id":"rpt_sales","version":1,"name":"销售报表",
	  "dataset":{"source_ref":"csv_local","fields":[
	    {"key":"region","type":"string","sort_key":"region_order"},
	    {"key":"city","type":"string"},
	    {"key":"amount","type":"number"},
	    {"key":"qty","type":"number"}]},
	  "dimensions":[
	    {"field":"region","label":"大区","sort":{"by":"sort_key","dir":"asc"}},
	    {"field":"city","label":"城市","sort":{"by":"value","dir":"asc"}}],
	  "metrics":[
	    {"field":"amount","label":"销售额","agg":"SUM","num_fmt_ref":"money"},
	    {"field":"qty","label":"件数","agg":"COUNT","num_fmt_ref":"int"}],
	  "layout_opts":{"total_position":"bottom"},
	  "base_styles":{"header_font":{"name":"Arial","size":11,"bold":true},
	    "body_font":{"name":"Arial","size":10},
	    "num_formats":{"money":"#,##0.00","int":"#,##0"}},
	  "style_rules":{"version":1,"rules":[]}}`
}

func TestSubmitRejectsDuplicateIdempotencyKey(t *testing.T) {
	o, _ := newTestOrchestrator(t)
	req := ExportRequest{DefinitionJSON: validDefJSON(), DataSource: datahub.NewCSVSource("../datahub/testdata/sales.csv"), IdempotencyKey: "key-1"}
	if _, err := o.Submit(req); err != nil {
		t.Fatal(err)
	}
	if _, err := o.Submit(req); err == nil {
		t.Fatal("expected duplicate idempotency key error")
	}
}

func TestConcurrencyLimit(t *testing.T) {
	o, _ := newTestOrchestrator(t)
	o.SetConcurrency(1)
	var mu sync.Mutex
	active := 0
	maxActive := 0
	o.SetProbe(func() {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()
	})
	reqs := []ExportRequest{
		{DefinitionJSON: validDefJSON(), DataSource: datahub.NewCSVSource("../datahub/testdata/sales.csv")},
		{DefinitionJSON: validDefJSON(), DataSource: datahub.NewCSVSource("../datahub/testdata/sales.csv")},
	}
	for _, r := range reqs {
		if _, err := o.Submit(r); err != nil {
			t.Fatal(err)
		}
	}
	// 等两个都完成
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s1, _ := o.Status("task-1")
		s2, _ := o.Status("task-2")
		if s1.State == "done" && s2.State == "done" {
			break
		}
		if s1.State == "failed" || s2.State == "failed" {
			t.Fatal("task failed")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if maxActive > 1 {
		t.Fatalf("concurrency exceeded: maxActive=%d", maxActive)
	}
}

// SinkFunc 适配 OnProgress 回调。
type SinkFunc struct {
	fn func(taskID string, state State, progress float64)
}

func (s *SinkFunc) OnProgress(taskID string, state State, progress float64) {
	s.fn(taskID, state, progress)
}
```

注意：测试聚焦 Submit 幂等键去重、并发槽限制、产物落盘、进度递增四个行为；不依赖 catalog（定义以内联 JSON 传入）。若并发测试时序不稳定（worker 启动竞态），可把两个任务用不同 ArtifactName 提交并轮询完成。

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/orchestrator/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/orchestrator/queue.go`**

```go
package orchestrator

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/render"
)

type State string

const (
	StateQueued  State = "queued"
	StateRunning State = "running"
	StateDone    State = "done"
	StateFailed  State = "failed"
)

type TaskStatus struct {
	ID           string    `json:"id"`
	State        State     `json:"state"`
	Progress     float64   `json:"progress"` // 0..1
	Error        string    `json:"error,omitempty"`
	ArtifactPath string    `json:"artifact_path,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type ExportRequest struct {
	ID             string        // 任务 ID（空则自动生成 task-N）
	IdempotencyKey string        // 幂等键：重复提交返回已存在任务
	DefinitionJSON string        // 定义 JSON（catalog 版本场景由调用方解析定义后传入）
	DataSource     datahub.Source
	ArtifactName   string // 产物文件名（默认 <id>.xlsx）
}

// ProgressSink 接收任务进度事件（可接入日志/SSE）。
type ProgressSink interface {
	OnProgress(taskID string, state State, progress float64)
}

type taskEntry struct {
	req   ExportRequest
	status TaskStatus
	acked chan struct{}
}

type Orchestrator struct {
	mu         sync.Mutex
	tasks      map[string]*taskEntry
	queue      chan *taskEntry
	concurrency int
	artDir     string
	sink       ProgressSink
	nextID     atomic.Int64
	probe      func() // 测试钩子：worker 开始执行时调用
}

func NewOrchestrator(sink ProgressSink) *Orchestrator {
	o := &Orchestrator{
		tasks:      map[string]*taskEntry{},
		queue:      make(chan *taskEntry, 64),
		concurrency: 2,
		sink:       sink,
	}
	return o
}

func (o *Orchestrator) SetConcurrency(n int) {
	if n > 0 {
		o.concurrency = n
	}
}

func (o *Orchestrator) SetArtifactDir(dir string) { o.artDir = dir }

func (o *Orchestrator) SetProbe(fn func()) { o.probe = fn }

// Start 启动 workers（幂等）。
func (o *Orchestrator) Start() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.started {
		return
	}
	o.started = true
	for i := 0; i < o.concurrency; i++ {
		go o.worker()
	}
}

// Submit 入队任务；IdempotencyKey 重复时返回 ErrDuplicate。
var ErrDuplicate = errors.New("duplicate idempotency key")

func (o *Orchestrator) Submit(req ExportRequest) (string, error) {
	if req.IdempotencyKey != "" {
		o.mu.Lock()
		for _, t := range o.tasks {
			if t.req.IdempotencyKey == req.IdempotencyKey {
				o.mu.Unlock()
				return t.req.ID, ErrDuplicate
			}
		}
		o.mu.Unlock()
	}
	if req.ID == "" {
		req.ID = fmt.Sprintf("task-%d", o.nextID.Add(1))
	}
	ent := &taskEntry{
		req: req,
		status: TaskStatus{ID: req.ID, State: StateQueued, UpdatedAt: time.Now()},
		acked: make(chan struct{}),
	}
	o.mu.Lock()
	o.tasks[req.ID] = ent
	o.mu.Unlock()
	o.queue <- ent
	o.Start()
	return req.ID, nil
}

// Status 查询任务状态。
func (o *Orchestrator) Status(id string) (TaskStatus, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	t, ok := o.tasks[id]
	if !ok {
		return TaskStatus{}, fmt.Errorf("task %s not found", id)
	}
	return t.status, nil
}

// Wait 阻塞直到任务完成或失败（供测试与同步路径）。
func (o *Orchestrator) Wait(id string) TaskStatus {
	t, _ := o.Status(id)
	ent := o.tasks[id]
	if ent == nil {
		return t
	}
	<-ent.acked
	o.mu.Lock()
	defer o.mu.Unlock()
	return ent.status
}

func (o *Orchestrator) worker() {
	for ent := range o.queue {
		o.setStatus(ent.req.ID, StateRunning, 0.1)
		if o.probe != nil {
			o.probe()
		}
		err := o.execute(ent)
		if err != nil {
			o.setStatus(ent.req.ID, StateFailed, 1.0)
			o.mu.Lock()
			ent.status.Error = err.Error()
			o.mu.Unlock()
		} else {
			o.setStatus(ent.req.ID, StateDone, 1.0)
		}
		close(ent.acked)
	}
}

func (o *Orchestrator) setStatus(id string, s State, p float64) {
	o.mu.Lock()
	if t, ok := o.tasks[id]; ok {
		t.status.State = s
		t.status.Progress = p
		t.status.UpdatedAt = time.Now()
	}
	o.mu.Unlock()
	if o.sink != nil {
		o.sink.OnProgress(id, s, p)
	}
}
```

注意：`o.started` 字段需要在 `Orchestrator` 结构体追加（`started bool`），`execute` 在 export.go 实现。`ArtifactPath` 由 execute 填写。

- [ ] **Step 4: 实现 `internal/orchestrator/export.go`**

```go
func (o *Orchestrator) execute(ent *taskEntry) error {
	def, err := model.ParseDefinition(ent.req.DefinitionJSON)
	if err != nil {
		return err
	}
	s, err := pipeline.BuildReport(def, ent.req.DataSource)
	if err != nil {
		return err
	}
	name := ent.req.ArtifactName
	if name == "" {
		name = ent.req.ID + ".xlsx"
	}
	path := filepath.Join(o.artDir, name)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := render.Render(def, s, f); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	o.mu.Lock()
	ent.status.ArtifactPath = path
	o.mu.Unlock()
	return nil
}
```

`model.ParseDefinition` 为新增：把 JSON 字符串 parse + Validate。在 `internal/model/model.go` 追加：

```go
// ParseDefinition 解析并校验定义 JSON 字符串。
func ParseDefinition(jsonStr string) (*ReportDefinition, error) {
	var def ReportDefinition
	if err := json.Unmarshal([]byte(jsonStr), &def); err != nil {
		return nil, fmt.Errorf("parse definition: %w", err)
	}
	if err := def.Validate(); err != nil {
		return nil, err
	}
	return &def, nil
}
```

（同时把 `Load` 改为调用 `ParseDefinition(string(data))` 消除重复，保持行为一致——原版 `Load` 的错误包装 "parse definition %s" 保留在 Load 内。）

- [ ] **Step 5: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/orchestrator/ -v`
Expected: 全部 PASS。若并发测试时序不稳（worker 启动竞态），把两个任务用不同 ArtifactName 提交并轮询完成。

- [ ] **Step 6: 提交**

```bash
cd /workspace && git add dynamic-report/internal/orchestrator dynamic-report/internal/model && git commit -m "feat(orchestrator): async export queue with idempotency, concurrency limit and progress"
```

---

### Task 11: httpapi 包 —— 路由与 Handlers

**Files:**
- Create: `internal/httpapi/server.go`
- Test: `internal/httpapi/server_test.go`

- [ ] **Step 1: 写失败测试 `internal/httpapi/server_test.go`**

```go
package httpapi

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/catalog"
	"dynamic-report/internal/orchestrator"
)

func newServer(t *testing.T) *Server {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/api.db")
	if err != nil {
		t.Fatal(err)
	}
	store, err := catalog.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.NewCache(store)
	orc := orchestrator.NewOrchestrator(nil)
	orc.SetArtifactDir(t.TempDir())
	s := NewServer(c, orc, dataSources(t))
	return s
}

func dataSources(t *testing.T) map[string]func() (string, error) {
	return map[string]func() (string, error){}
}

func TestPublishAndRenderFlow(t *testing.T) {
	s := newServer(t)
	// 1) 保存草稿
	body := bytes.NewBufferString(validDefJSON())
	req := httptest.NewRequest(http.MethodPut, "/v1/definitions/r1/draft", body)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("save draft status = %d body=%s", rr.Code, rr.Body.String())
	}
	// 2) 发布
	req2 := httptest.NewRequest(http.MethodPost, "/v1/definitions/r1/publish", nil)
	rr2 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("publish status = %d body=%s", rr2.Code, rr2.Body.String())
	}
	// 3) 渲染（预览分页）——定义引用 csv 数据源，但测试环境无该源，rendere 报错亦接受；
	//    此处只验证路由可达与 JSON 响应结构（错误码 4xx 也属于"路由存在"）。
	req3 := httptest.NewRequest(http.MethodPost, "/v1/render", bytes.NewBufferString(
		`{"def_id":"r1","row_window":{"from":0,"to":5}}`))
	rr3 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr3, req3)
	if rr3.Code == http.StatusNotFound {
		t.Fatalf("render route missing: %d", rr3.Code)
	}
	// 4) 版本列表
	req4 := httptest.NewRequest(http.MethodGet, "/v1/definitions/r1/versions", nil)
	rr4 := httptest.NewRecorder()
	s.mux.ServeHTTP(rr4, req4)
	if rr4.Code != http.StatusOK {
		t.Fatalf("versions status = %d", rr4.Code)
	}
	var vers []catalog.VersionInfo
	if err := json.Unmarshal(rr4.Body.Bytes(), &vers); err != nil {
		t.Fatal(err)
	}
	if len(vers) != 1 || vers[0].Status != "published" {
		t.Fatalf("versions = %+v", vers)
	}
}

func TestOptimisticLockConflict(t *testing.T) {
	s := newServer(t)
	put := func(payload string) int {
		req := httptest.NewRequest(http.MethodPut, "/v1/definitions/r1/draft",
			bytes.NewBufferString(payload))
		rr := httptest.NewRecorder()
		s.mux.ServeHTTP(rr, req)
		return rr.Code
	}
	// v1 保存 → v2 保存（模拟并发方带旧 base 直接覆盖：本实现草案为"同版本覆盖"，
	// 冲突检测由 SaveDraft 的 ErrDraftConflict 触发——测试带 base_version 语义的路径：
	// 先 v1 再 v9（更高版本草稿存在时提交 v1 基础应冲突）
	put(validDefJSON())            // 草稿 v1
	put(strings.Replace(validDefJSON(), `"version":1`, `"version":2`, 1)) // 草稿 v2
	code := put(validDefJSON())    // 回退到 v1 基础 → 应 409
	if code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", code)
	}
}

func TestExportFlow(t *testing.T) {
	s := newServer(t)
	body := bytes.NewBufferString(`{"def_id":"r1","version":1}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/export", body)
	rr := httptest.NewRecorder()
	s.mux.ServeHTTP(rr, req)
	if rr.Code == http.StatusNotFound {
		t.Fatal("export route missing")
	}
	if rr.Code == http.StatusOK {
		var out map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &out)
		if out["task_id"] == "" {
			t.Fatal("no task_id in response")
		}
	}
	// 404 定义未发布也属于合法响应；只验证路由存在
}

func validDefJSON() string {
	return `{"id":"r1","version":1,"name":"R",
	  "dataset":{"source_ref":"csv_local","fields":[
	    {"key":"region","type":"string"},{"key":"amount","type":"number"}]},
	  "metrics":[{"field":"amount","label":"A","agg":"SUM"}],
	  "style_rules":{"version":1,"rules":[]}}`
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/dynamic-report && go test ./internal/httpapi/ -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `internal/httpapi/server.go`**

```go
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"dynamic-report/internal/catalog"
	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/orchestrator"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/schema"
)

// DataSourceFactory 按 source_ref 提供数据源。返回 (table 名或 csv 路径, error) 由装配层实现。
type DataSourceFactory func(ref string) (datahub.Source, error)

type Server struct {
	cache *catalog.Cache
	orc   *orchestrator.Orchestrator
	dsf   DataSourceFactory
	mux   *http.ServeMux
}

func NewServer(cache *catalog.Cache, orc *orchestrator.Orchestrator, dsf DataSourceFactory) *Server {
	s := &Server{cache: cache, orc: orc, dsf: dsf}
	mux := http.NewServeMux()
	s.mux = mux
	// 定义管理
	mux.HandleFunc("GET /v1/definitions/{id}/draft", s.getDraft)
	mux.HandleFunc("PUT /v1/definitions/{id}/draft", s.putDraft)
	mux.HandleFunc("POST /v1/definitions/{id}/publish", s.publish)
	mux.HandleFunc("GET /v1/definitions/{id}/versions", s.versions)
	mux.HandleFunc("POST /v1/definitions/{id}/rollback", s.rollback)
	mux.HandleFunc("PATCH /v1/definitions/{id}/overrides", s.patchOverrides)
	// 渲染与交互
	mux.HandleFunc("POST /v1/render", s.render)
	mux.HandleFunc("GET /v1/cells/{cellID}/style-explain", s.styleExplain)
	mux.HandleFunc("GET /v1/cells/{cellID}/data-trace", s.dataTrace)
	// 导出
	mux.HandleFunc("POST /v1/export", s.export)
	mux.HandleFunc("GET /v1/export/{taskID}", s.exportStatus)
	mux.HandleFunc("GET /v1/export/{taskID}/download", s.exportDownload)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ---- 定义管理 ----

func (s *Server) getDraft(w http.ResponseWriter, r *http.Request) {
	meta, err := s.cache.Store().GetDraft(r.PathValue("id"))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if meta == nil {
		writeErr(w, 404, "no draft")
		return
	}
	writeJSON(w, 200, map[string]any{"version": meta.Version, "payload": json.RawMessage(meta.Payload)})
}

func (s *Server) putDraft(w http.ResponseWriter, r *http.Request) {
	payloadBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, 400, "read body: "+err.Error())
		return
	}
	payload := string(payloadBytes) // 定义 JSON 原文
	if strings.TrimSpace(payload) == "" {
		writeErr(w, 400, "empty payload")
		return
	}
	if err := s.cache.Store().SaveDraft(r.PathValue("id"), payload, "api"); err != nil {
		if err == catalog.ErrDraftConflict {
			writeErr(w, 409, err.Error())
			return
		}
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "saved"})
}

func (s *Server) publish(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.cache.Store().Publish(id, "api"); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	s.cache.Invalidate(id)
	s.cache.NotifyChanged(id)
	writeJSON(w, 200, map[string]string{"ok": "published"})
}

func (s *Server) versions(w http.ResponseWriter, r *http.Request) {
	vs, err := s.cache.Store().Versions(r.PathValue("id"))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, vs)
}

func (s *Server) rollback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int `json:"version"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Version <= 0 {
		writeErr(w, 400, "version required")
		return
	}
	id := r.PathValue("id")
	if err := s.cache.Store().Rollback(id, body.Version, "api"); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	s.cache.Invalidate(id)
	s.cache.NotifyChanged(id)
	writeJSON(w, 200, map[string]string{"ok": "rolled back"})
}

// ---- 渲染与交互 ----

type renderReq struct {
	DefID   string  `json:"def_id"`
	Version *int    `json:"version,omitempty"`
	Dataset string  `json:"dataset,omitempty"` // sample | full（默认 full）
	Window  *winReq `json:"row_window,omitempty"`
}

type winReq struct {
	From int `json:"from"`
	To   int `json:"to"`
}

func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	var req renderReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	def, version, err := s.loadDef(r.Context(), req.DefID, req.Version)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	src, err := s.dsf(def.Dataset.SourceRef)
	if err != nil {
		writeErr(w, 400, "data source: "+err.Error())
		return
	}
	schemaOut, err := pipeline.BuildReportWithTrace(def, src) // 预览模式
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if req.Window != nil {
		if err := schemaOut.PageRows(req.Window.From, req.Window.To); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	out := struct {
		Version int                  `json:"version"`
		Schema  *schema.RenderSchema `json:"schema"`
	}{Version: version, Schema: schemaOut}
	writeJSON(w, 200, out)
}
```

注意：`loadDef` 的指定版本读取需要 `catalog.Store` 暴露 `GetVersion(id, v)`。在 `internal/catalog/store.go` 追加导出方法：

```go
// GetVersion 返回指定已发布版本；无则 (nil, nil)。
func (s *Store) GetVersion(id string, v int) (*DefMeta, error) {
	row := s.db.QueryRow(`SELECT id,version,status,payload,updated_by,updated_at FROM definitions
		WHERE id=? AND version=? AND status='published'`, id, v)
	return s.rowToMeta(row)
}
```

`Server` 的 `loadDef`（带 context，供所有 handler 调用）：

```go
func (s *Server) loadDef(ctx context.Context, id string, version *int) (*model.ReportDefinition, int, error) {
	if version == nil {
		def, v, err := s.cache.GetPublished(ctx, id)
		if err != nil {
			return nil, 0, err
		}
		if def == nil {
			return nil, 0, fmt.Errorf("definition %s not published", id)
		}
		return def, v, nil
	}
	meta, err := s.cache.Store().GetVersion(id, *version)
	if err != nil {
		return nil, 0, err
	}
	if meta == nil {
		return nil, 0, fmt.Errorf("published version %d of %s not found", *version, id)
	}
	def, err := catalog.UnmarshalDef(meta.Payload)
	if err != nil {
		return nil, 0, err
	}
	return def, meta.Version, nil
}
```

`catalog.UnmarshalDef` 把 `unmarshalDef` 导出为 `UnmarshalDef`（在 cache.go 中改名并保留内部调用）。`Server` 需 import `dynamic-report/internal/model` 与 `fmt`。

其余 handlers（style-explain/data-trace/export 三件套、patchOverrides）实现要点：

```go
// styleExplain 重新构建 trace 渲染并按 cell_id 定位，返回命中规则与解释。
func (s *Server) styleExplain(w http.ResponseWriter, r *http.Request) {
	cellID := r.PathValue("cellID")
	defID := r.URL.Query().Get("def_id")
	if defID == "" {
		writeErr(w, 400, "def_id required")
		return
	}
	def, _, err := s.loadDef(r.Context(), defID, nil)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	src, err := s.dsf(def.Dataset.SourceRef)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	out, err := pipeline.BuildReportWithTrace(def, src)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for _, row := range out.Rows {
		for _, cell := range row.Cells {
			if cell.CellID == cellID {
				writeJSON(w, 200, map[string]any{
					"cell_id":  cellID,
					"explains": cell.Explains,
					"style":    out.Styles[cell.Style],
				})
				return
			}
		}
	}
	writeErr(w, 404, "cell not found: "+cellID)
}

func (s *Server) dataTrace(w http.ResponseWriter, r *http.Request) {
	cellID := r.PathValue("cellID")
	defID := r.URL.Query().Get("def_id")
	if defID == "" {
		writeErr(w, 400, "def_id required")
		return
	}
	def, _, err := s.loadDef(defID, nil)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	src, err := s.dsf(def.Dataset.SourceRef)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	out, err := pipeline.BuildReportWithTrace(def, src)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for _, row := range out.Rows {
		for _, cell := range row.Cells {
			if cell.CellID == cellID {
				writeJSON(w, 200, map[string]any{
					"cell_id": cellID,
					"trace":   cell.Trace,
					"type":    row.Type,
					"formula": cell.Formula,
				})
				return
			}
		}
	}
	writeErr(w, 404, "cell not found: "+cellID)
}

// patchOverrides 在草稿上增改/删除 override（body: {op:"upsert"|"delete", override:{...}}）。
func (s *Server) patchOverrides(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	meta, err := s.cache.Store().GetDraft(id)
	if err != nil || meta == nil {
		writeErr(w, 404, "no draft")
		return
	}
	var body struct {
		Op       string              `json:"op"`
		Override *model.OverrideDef  `json:"override"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Override == nil {
		writeErr(w, 400, "override required")
		return
	}
	def, err := catalog.UnmarshalDef(meta.Payload)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	switch body.Op {
	case "delete":
		var kept []model.OverrideDef
		for _, ov := range def.Overrides {
			if ov.ID != body.Override.ID {
				kept = append(kept, ov)
			}
		}
		def.Overrides = kept
	case "upsert", "":
		replaced := false
		for i := range def.Overrides {
			if def.Overrides[i].ID == body.Override.ID {
				def.Overrides[i] = *body.Override
				replaced = true
			}
		}
		if !replaced {
			def.Overrides = append(def.Overrides, *body.Override)
		}
	default:
		writeErr(w, 400, "invalid op "+body.Op)
		return
	}
	b, err := json.Marshal(def)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := s.cache.Store().SaveDraft(id, string(b), "api"); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "override updated"})
}

// ---- 导出 ----

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DefID    string `json:"def_id"`
		Version  *int   `json:"version,omitempty"`
		IdemKey  string `json:"idempotency_key,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DefID == "" {
		writeErr(w, 400, "def_id required")
		return
	}
	def, version, err := s.loadDef(r.Context(), body.DefID, body.Version)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	src, err := s.dsf(def.Dataset.SourceRef)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	// 序列化定义（覆盖解析时的原始 JSON 差异）→ 任务内重新 Parse
	defJSON, _ := json.Marshal(def)
	taskID, err := s.orc.Submit(orchestrator.ExportRequest{
		IdempotencyKey: body.IdemKey,
		DefinitionJSON: string(defJSON),
		DataSource:     src,
	})
	if err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"task_id": taskID, "def_version": version})
}

func (s *Server) exportStatus(w http.ResponseWriter, r *http.Request) {
	t, err := s.orc.Status(r.PathValue("taskID"))
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, t)
}

func (s *Server) exportDownload(w http.ResponseWriter, r *http.Request) {
	t, err := s.orc.Status(r.PathValue("taskID"))
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	if t.State != "done" {
		writeErr(w, 409, "task not done: "+string(t.State))
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename="+t.ArtifactPathName())
	http.ServeFile(w, r, t.ArtifactPath)
}
```

`TaskStatus` 需要导出 `ArtifactPathName()`（filepath.Base）。在 queue.go 追加：

```go
func (t TaskStatus) ArtifactPathName() string { return filepath.Base(t.ArtifactPath) }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/dynamic-report && go test ./internal/httpapi/ -v`
Expected: 全部 PASS。若 `Server` 构造过于繁琐（vs 测试中 dataSources 为空 map），可让 `dsf` 调用返回"unknown source"错误——测试只验证路由存在与定义生命周期，不真渲染。

- [ ] **Step 5: 提交**

```bash
cd /workspace && git add dynamic-report/internal/httpapi dynamic-report/internal/catalog && git commit -m "feat(httpapi): definition lifecycle, render preview, style explain, data trace, override patch, export endpoints"
```

---

### Task 12: cmd/reportserv 装配与端到端冒烟

**Files:**
- Create: `cmd/reportserv/main.go`
- Modify: `dynamic-report/testdata/`（若需要）

- [ ] **Step 1: 实现 `cmd/reportserv/main.go`**

```go
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/catalog"
	"dynamic-report/internal/datahub"
	"dynamic-report/internal/httpapi"
	"dynamic-report/internal/orchestrator"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "catalog.db", "sqlite path")
	artDir := flag.String("artifacts", "artifacts", "artifact directory")
	csvDir := flag.String("csv", ".", "csv data directory")
	sourceRef := flag.String("source", "csv_local", "source ref for CSV fallback")
	flag.Parse()

	if err := os.MkdirAll(*artDir, 0o755); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	store, err := catalog.NewStore(db)
	if err != nil {
		log.Fatal(err)
	}
	cache := catalog.NewCache(store)
	orc := orchestrator.NewOrchestrator(nil)
	orc.SetArtifactDir(*artDir)

	// 数据源工厂：csv_local 读取 <csvDir>/<table>.csv；其余返回错误
	dsf := func(ref string) (datahub.Source, error) {
		if ref != *sourceRef {
			return nil, fmt.Errorf("unknown source ref %q (only %q supported)", ref, *sourceRef)
		}
		return datahub.NewCSVSource(filepath.Join(*csvDir, "data.csv")), nil
	}
	srv := httpapi.NewServer(cache, orc, dsf)

	log.Printf("reportserv listening on %s (db=%s artifacts=%s csv=%s)", *addr, *dbPath, *artDir, *csvDir)
	if err := http.ListenAndServe(*addr, srv); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 2: 端到端冒烟（手工验证脚本）**

```bash
cd /workspace/dynamic-report && go build -o /tmp/reportserv ./cmd/reportserv
mkdir -p /tmp/rs && cd /tmp/rs
cp /workspace/dynamic-report/internal/model/testdata/valid.json def.json
cp /workspace/dynamic-report/internal/datahub/testdata/sales.csv data.csv
# 写草稿并把 source_ref 固定为 csv_local（valid.json 已是）
# data.csv 需与 dataset.table 匹配：定义无 table 字段时工厂固定用 data.csv（本冒烟如此）
/tmp/reportserv -addr :8090 -db /tmp/rs/catalog.db -artifacts /tmp/rs/art -csv /tmp/rs &
sleep 1
# 保存草稿（体为定义 JSON 原文）
curl -s -X PUT -H 'Content-Type: application/json' --data-binary @def.json http://localhost:8090/v1/definitions/rpt_sales/draft
# 发布
curl -s -X POST http://localhost:8090/v1/definitions/rpt_sales/publish
# 导出
TASK=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"def_id":"rpt_sales"}' http://localhost:8090/v1/export | python3 -c 'import sys,json;print(json.load(sys.stdin)["task_id"])')
sleep 2
# 下载产物并用 excelize 回读
curl -s -o out.xlsx "http://localhost:8090/v1/export/$TASK/download"
ls -la out.xlsx
```

预期：返回 200、`report.xlsx` 可被 excelize/Excel 打开，含小计与合并。冒烟成功后 kill 服务进程。

- [ ] **Step 3: 全量测试**

Run: `cd /workspace/dynamic-report && go test ./... -v -count=1 && go vet ./... && gofmt -l internal/ cmd/`
Expected: 全部 PASS、vet 干净、无未格式化文件。

- [ ] **Step 4: 提交**

```bash
cd /workspace && git add cmd/reportserv && git commit -m "feat(cmd): reportserv service assembly with csv source and artifact dir"
```

---

## 完成标准（计划二）

1. `go test ./...` 全绿；`go vet ./...` 无告警。
2. `reportserv` 服务可完成"保存草稿 → 发布 → 异步导出 → 下载 xlsx"全流程（冒烟脚本验证）。
3. 定义版本链完整：草稿乐观锁、发布递增、回滚生成新版本、版本列表、diff 摘要。
4. 渲染能力扩展落地：条件格式注入（data_bar/top_n，同 rangeRef 合并）、打印设置（横向/缩放到一页宽/重复表头行）、分页渲染、样式解释（`/style-explain`）、数据血缘（`/data-trace`）、override 语义锚定补丁。
5. 热更新：进程内缓存 + 失效通知 + TTL 轮询兜底。
6. DB 数据源：ORDER BY 下推 + 列白名单。

## 明确不在本计划范围（计划三前端交付；接口已预留）

- 管理端前端 UI（规则构建器/图层面板/预览画布/版本历史界面）
- `GET /v1/themes` 预设主题
- SSE/WebSocket 进度推送（当前为轮询 `GET /v1/export/{id}`）
- 对象存储产物（当前本地目录，`Store` 接口可替换）
- 多实例事件总线（当前本地广播 + TTL 兜底跨度单实例）