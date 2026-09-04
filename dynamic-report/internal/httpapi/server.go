package httpapi

import (
	"context"
	"encoding/json"
	"errors"
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
		if errors.Is(err, catalog.ErrDraftConflict) {
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

// loadDef 解析定义：未指定版本走缓存的最新已发布；指定版本走 Store.GetVersion。
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
		Op       string             `json:"op"`
		Override *model.OverrideDef `json:"override"`
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
		DefID   string `json:"def_id"`
		Version *int   `json:"version,omitempty"`
		IdemKey string `json:"idempotency_key,omitempty"`
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
