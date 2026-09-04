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
	// 等待首个任务落盘完成，避免 TempDir 清理时产物仍在写入。
	o.Wait("task-1")
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
	o.SetProbeEnd(func() {
		mu.Lock()
		active--
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
