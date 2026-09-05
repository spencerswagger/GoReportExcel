package catalog

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/catalog.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := NewStore(db, DialectSQLite)
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
	// Published max+1: drafts do not consume version numbers.
	pub, err := s.GetPublished("r1")
	if err != nil {
		t.Fatalf("GetPublished after publish: %v", err)
	}
	if pub == nil || pub.Version != 3 {
		t.Errorf("published Version = %+v, want 3", pub)
	}
	if err := s.Rollback("r1", 2, "c"); err != nil {
		t.Fatalf("Rollback to 2: %v", err)
	}
	pub, err = s.GetPublished("r1")
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

func TestStoreSaveDraftRejectsPublishedCollision(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "alice"); err != nil {
		t.Fatalf("SaveDraft v1: %v", err)
	}
	if err := s.Publish("r1", "a"); err != nil {
		t.Fatalf("Publish v2: %v", err)
	}
	// A draft whose base version equals an existing published version must not
	// silently overwrite the published row.
	if err := s.SaveDraft("r1", validPayload("r1", 2), "bob"); err == nil {
		t.Fatal("SaveDraft with base version equal to a published version should fail")
	}
	// The published row must be untouched and still publishable.
	pub, err := s.GetPublished("r1")
	if err != nil || pub == nil {
		t.Fatalf("published = %v err = %v", pub, err)
	}
	if pub.Version != 2 {
		t.Fatalf("published version = %d, want 2", pub.Version)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(pub.Payload), &m); err != nil {
		t.Fatalf("unmarshal published payload: %v", err)
	}
	if m["name"] != "R" {
		t.Fatalf("published payload corrupted: %v", m["name"])
	}
}

func TestStoreNewStoreIdempotent(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+t.TempDir()+"/catalog.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := NewStore(db, DialectSQLite); err != nil {
		t.Fatalf("first NewStore: %v", err)
	}
	if _, err := NewStore(db, DialectSQLite); err != nil {
		t.Fatalf("second NewStore on existing schema should succeed: %v", err)
	}
}

func TestStoreDraftConflictRejected(t *testing.T) {
	s := openTest(t)
	if err := s.SaveDraft("r1", validPayload("r1", 1), "a"); err != nil {
		t.Fatalf("SaveDraft v1: %v", err)
	}
	if err := s.SaveDraft("r1", validPayload("r1", 2), "b"); err != nil {
		t.Fatalf("SaveDraft v2: %v", err)
	}
	// Base version 1 is older than the stored draft v2: must be rejected.
	err := s.SaveDraft("r1", validPayload("r1", 1), "c")
	if !errors.Is(err, ErrDraftConflict) {
		t.Fatalf("err = %v, want ErrDraftConflict", err)
	}
}

// TestStorePostgresLifecycle exercises the full draft→publish→rollback flow
// against a real PostgreSQL server. It is skipped unless TEST_PG_DSN is set,
// e.g.:
//
//	TEST_PG_DSN='postgres://user:pass@localhost:5432/goreport_test?sslmode=disable' \
//		go test ./internal/catalog/ -run TestStorePostgresLifecycle -v
//
// The DSN may point at any throwaway database on a developer or CI Postgres:
// the test drops the definitions table before and after itself.
func TestStorePostgresLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_PG_DSN")
	if dsn == "" {
		t.Skip("TEST_PG_DSN not set; skipping PostgreSQL integration test")
	}
	db, err := sql.Open(PostgresDriver, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`DROP TABLE IF EXISTS definitions`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DROP TABLE IF EXISTS definitions`)
	})
	if err := db.Ping(); err != nil {
		t.Fatalf("ping postgres: %v (is the server up and the DSN valid?)", err)
	}

	s, err := NewStore(db, DialectPostgres)
	if err != nil {
		t.Fatalf("NewStore(postgres): %v", err)
	}
	// Schema creation is idempotent like on SQLite.
	if _, err := NewStore(db, DialectPostgres); err != nil {
		t.Fatalf("second NewStore(postgres): %v", err)
	}

	if err := s.SaveDraft("pg1", validPayload("pg1", 1), "test"); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	draft, err := s.GetDraft("pg1")
	if err != nil || draft == nil || draft.Version != 1 {
		t.Fatalf("GetDraft = %v err = %v", draft, err)
	}
	if err := s.Publish("pg1", "test"); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	// 首个发布版本 = 草稿版本 + 1（与 SQLite 流程一致）。
	pub, err := s.GetPublished("pg1")
	if err != nil || pub == nil {
		t.Fatalf("GetPublished = %v err = %v", pub, err)
	}
	if pub.Version != 2 {
		t.Fatalf("published version = %d, want 2", pub.Version)
	}
	if err := s.Rollback("pg1", 2, "test"); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	// 回滚产生一个新发布版本 v3，全库共 v2、v3 两行。
	vs, err := s.Versions("pg1")
	if err != nil || len(vs) != 2 {
		t.Fatalf("Versions = %v err = %v (want 2 rows)", vs, err)
	}
}
