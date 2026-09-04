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
	t.Cleanup(func() { db.Close() })
	s, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func validPayload(id string, version int) string {
	def := map[string]any{
		"id":      id,
		"version": version,
		"name":    "R",
		"dataset": map[string]any{
			"source_ref": "csv_local",
			"fields": []map[string]any{
				{"key": "region", "type": "string"},
				{"key": "amount", "type": "number"},
			},
		},
		"metrics": []map[string]any{
			{"field": "amount", "label": "销售额", "agg": "SUM"},
		},
		"style_rules": map[string]any{},
	}
	b, err := json.Marshal(def)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func TestStoreSaveDraftAndGet(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	m, err := s.GetDraft("r1")
	if err != nil {
		t.Fatalf("GetDraft: %v", err)
	}
	if m == nil {
		t.Fatal("GetDraft returned nil")
	}
	if m.Version != 1 {
		t.Errorf("Version = %d, want 1", m.Version)
	}
	if m.Status != "draft" {
		t.Errorf("Status = %q, want draft", m.Status)
	}
	if m.UpdatedBy != "alice" {
		t.Errorf("UpdatedBy = %q, want alice", m.UpdatedBy)
	}
	var def struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(m.Payload), &def); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if def.Name != "R" {
		t.Errorf("payload name = %q, want R", def.Name)
	}
}

func TestStoreOptimisticLockConflict(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft v1 first: %v", err)
	}
	// Same base version overwrites the draft content.
	other := validPayload("r1", 1)
	if err := s.SaveDraft("r1", other, "bob"); err != nil {
		t.Fatalf("SaveDraft v1 second with same base: %v", err)
	}
	m, err := s.GetDraft("r1")
	if err != nil {
		t.Fatalf("GetDraft: %v", err)
	}
	if m == nil {
		t.Fatal("GetDraft returned nil")
	}
	if m.UpdatedBy != "bob" {
		t.Errorf("UpdatedBy = %q, want bob", m.UpdatedBy)
	}
}

func TestStorePublishAndVersions(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	if err := s.Publish("r1", "a"); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	pub, err := s.GetPublished("r1")
	if err != nil {
		t.Fatalf("GetPublished: %v", err)
	}
	if pub == nil {
		t.Fatal("GetPublished returned nil")
	}
	if pub.Version != 2 {
		t.Errorf("published Version = %d, want 2", pub.Version)
	}
	if pub.Status != "published" {
		t.Errorf("published Status = %q, want published", pub.Status)
	}
	draft, err := s.GetDraft("r1")
	if err != nil {
		t.Fatalf("GetDraft after publish: %v", err)
	}
	if draft != nil {
		t.Errorf("GetDraft after publish = %+v, want nil", draft)
	}
	vs, err := s.Versions("r1")
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(vs) != 1 {
		t.Fatalf("len(Versions) = %d, want 1", len(vs))
	}
	if vs[0].Version != 2 {
		t.Errorf("Versions[0].Version = %d, want 2", vs[0].Version)
	}
}

func TestStoreRollback(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft v1: %v", err)
	}
	if err := s.Publish("r1", "a"); err != nil {
		t.Fatalf("Publish v2: %v", err)
	}
	if err := s.SaveDraft("r1", validPayload("r1", 3), "bob"); err != nil {
		t.Fatalf("SaveDraft v3: %v", err)
	}
	if err := s.Publish("r1", "b"); err != nil {
		t.Fatalf("Publish v3: %v", err)
	}
	if err := s.Rollback("r1", 2, "c"); err != nil {
		t.Fatalf("Rollback to 2: %v", err)
	}
	pub, err := s.GetPublished("r1")
	if err != nil {
		t.Fatalf("GetPublished: %v", err)
	}
	if pub == nil {
		t.Fatal("GetPublished returned nil")
	}
	if pub.Version != 4 {
		t.Errorf("Version = %d, want 4", pub.Version)
	}
	var def struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(pub.Payload), &def); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if def.Version != 4 {
		t.Errorf("payload version = %d, want 4", def.Version)
	}
}

func TestStoreDiffSummary(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft v1: %v", err)
	}
	if err := s.Publish("r1", "a"); err != nil {
		t.Fatalf("Publish v2: %v", err)
	}

	changed := map[string]any{
		"id":          "r1",
		"version":     1,
		"name":        "R-改版",
		"dataset":     map[string]any{"source_ref": "csv_local", "fields": []map[string]any{{"key": "region", "type": "string"}, {"key": "amount", "type": "number"}, {"key": "qty", "type": "number"}}},
		"dimensions":  []map[string]any{{"field": "region", "label": "大区", "sort": map[string]any{"by": "sort_key", "dir": "asc"}}},
		"metrics":     []map[string]any{{"field": "amount", "label": "销售额", "agg": "SUM"}, {"field": "qty", "label": "件数", "agg": "SUM"}},
		"style_rules": map[string]any{},
	}
	cb, err := json.Marshal(changed)
	if err != nil {
		t.Fatalf("marshal changed: %v", err)
	}
	if err := s.SaveDraft("r1", string(cb), "bob"); err != nil {
		t.Fatalf("SaveDraft changed v2: %v", err)
	}
	if err := s.Publish("r1", "b"); err != nil {
		t.Fatalf("Publish v3: %v", err)
	}

	keys, err := s.DiffSummary("r1", 3, 2)
	if err != nil {
		t.Fatalf("DiffSummary: %v", err)
	}
	got := make(map[string]bool, len(keys))
	for _, k := range keys {
		got[k] = true
	}
	for _, want := range []string{"name", "dimensions", "metrics", "dataset"} {
		if !got[want] {
			t.Errorf("DiffSummary missing key %q; got %v", want, keys)
		}
	}
}
