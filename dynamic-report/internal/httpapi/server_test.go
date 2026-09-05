package httpapi

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/catalog"
	"dynamic-report/internal/datahub"
	"dynamic-report/internal/orchestrator"
)

func newServer(t *testing.T) *Server {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/api.db")
	if err != nil {
		t.Fatal(err)
	}
	store, err := catalog.NewStore(db, catalog.DialectSQLite)
	if err != nil {
		t.Fatal(err)
	}
	c := catalog.NewCache(store)
	orc := orchestrator.NewOrchestrator(nil)
	orc.SetArtifactDir(t.TempDir())
	s := NewServer(c, orc, dataSources(t))
	return s
}

// dataSources 返回一个恒报错的数据源工厂：测试只验证路由与定义生命周期，不真渲染。
func dataSources(t *testing.T) DataSourceFactory {
	return func(ref string) (datahub.Source, error) {
		return nil, fmt.Errorf("unknown source %q", ref)
	}
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
	put(validDefJSON())                                                   // 草稿 v1
	put(strings.Replace(validDefJSON(), `"version":1`, `"version":2`, 1)) // 草稿 v2
	code := put(validDefJSON())                                           // 回退到 v1 基础 → 应 409
	if code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", code)
	}
}

func TestExportFlow(t *testing.T) {
	s := newServer(t)
	// 先发布定义，使导出路由越过 loadDef（数据源工厂恒报错 → 400 也属于合法响应）。
	put := httptest.NewRequest(http.MethodPut, "/v1/definitions/r1/draft",
		bytes.NewBufferString(validDefJSON()))
	rrPut := httptest.NewRecorder()
	s.mux.ServeHTTP(rrPut, put)
	if rrPut.Code != http.StatusOK {
		t.Fatalf("save draft status = %d", rrPut.Code)
	}
	pub := httptest.NewRequest(http.MethodPost, "/v1/definitions/r1/publish", nil)
	rrPub := httptest.NewRecorder()
	s.mux.ServeHTTP(rrPub, pub)
	if rrPub.Code != http.StatusOK {
		t.Fatalf("publish status = %d", rrPub.Code)
	}
	body := bytes.NewBufferString(`{"def_id":"r1"}`)
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
	// 数据源工厂报错 → 400 也属于合法响应；只验证路由存在
}

func validDefJSON() string {
	return `{"id":"r1","version":1,"name":"R",
	  "dataset":{"source_ref":"csv_local","fields":[
	    {"key":"region","type":"string"},{"key":"amount","type":"number"}]},
	  "metrics":[{"field":"amount","label":"A","agg":"SUM"}],
	  "style_rules":{"version":1,"rules":[]}}`
}
