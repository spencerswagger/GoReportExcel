package catalog

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrDraftConflict is returned by SaveDraft when the base version of the
// incoming payload is older than the currently stored draft.
var ErrDraftConflict = errors.New("draft conflict: base version outdated")

const schemaSQL = `
CREATE TABLE definitions (
	id TEXT,
	version INTEGER,
	status TEXT,
	payload TEXT,
	updated_by TEXT,
	updated_at TEXT,
	PRIMARY KEY (id, version)
);
CREATE INDEX idx_defs_id ON definitions (id);
`

// DefMeta is the full stored metadata of one definition version.
type DefMeta struct {
	ID        string
	Version   int
	Status    string
	Payload   string
	UpdatedBy string
	UpdatedAt string
}

// VersionInfo is the version metadata of a definition.
type VersionInfo struct {
	Version   int    `json:"version"`
	Status    string `json:"status"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt string `json:"updated_at"`
}

// Store persists report definitions in a SQLite database.
type Store struct {
	db *sql.DB
}

// NewStore creates a Store backed by db and applies the schema.
func NewStore(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("catalog: init schema: %w", err)
	}
	return &Store{db: db}, nil
}

// now returns the current time in RFC3339 UTC.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// rowToMeta scans a single definitions row into a DefMeta.
// It returns (nil, nil) when no row matches.
func rowToMeta(row *sql.Row) (*DefMeta, error) {
	var m DefMeta
	if err := row.Scan(&m.ID, &m.Version, &m.Status, &m.Payload, &m.UpdatedBy, &m.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// GetDraft returns the newest draft of the definition, or nil when absent.
func (s *Store) GetDraft(id string) (*DefMeta, error) {
	row := s.db.QueryRow(`SELECT id, version, status, payload, updated_by, updated_at
		FROM definitions WHERE id = ? AND status = 'draft'
		ORDER BY version DESC, updated_at DESC LIMIT 1`, id)
	return rowToMeta(row)
}

// GetPublished returns the newest published version of the definition, or nil
// when absent.
func (s *Store) GetPublished(id string) (*DefMeta, error) {
	row := s.db.QueryRow(`SELECT id, version, status, payload, updated_by, updated_at
		FROM definitions WHERE id = ? AND status = 'published'
		ORDER BY version DESC, updated_at DESC LIMIT 1`, id)
	return rowToMeta(row)
}

// SaveDraft upserts a draft payload, rejecting drafts whose base version is
// older than the currently stored draft.
func (s *Store) SaveDraft(id, payload, by string) error {
	var p struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return fmt.Errorf("save draft %s: parse payload: %w", id, err)
	}

	var maxV *int
	if err := s.db.QueryRow(`SELECT MAX(version) FROM definitions WHERE id = ? AND status = 'draft'`, id).Scan(&maxV); err != nil {
		return fmt.Errorf("save draft %s: %w", id, err)
	}
	if maxV != nil && *maxV > p.Version {
		return fmt.Errorf("%w: have %d, base %d", ErrDraftConflict, *maxV, p.Version)
	}

	_, err := s.db.Exec(`INSERT INTO definitions(id, version, status, payload, updated_by, updated_at)
		VALUES (?, ?, 'draft', ?, ?, ?)
		ON CONFLICT(id, version) DO UPDATE SET
			payload = excluded.payload,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at`,
		id, p.Version, payload, by, now())
	if err != nil {
		return fmt.Errorf("save draft %s: %w", id, err)
	}
	return nil
}

// Publish promotes the newest draft to a published version.
func (s *Store) Publish(id, by string) error {
	draft, err := s.GetDraft(id)
	if err != nil {
		return err
	}
	if draft == nil {
		return fmt.Errorf("publish %s: no draft found", id)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// The next version is one above the highest version ever used for this
	// definition (across both drafts and published versions).
	var maxV int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM definitions WHERE id = ?`, id).Scan(&maxV); err != nil {
		return err
	}
	newV := maxV + 1
	payload, err := bumpVersion(draft.Payload, newV)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO definitions(id, version, status, payload, updated_by, updated_at)
		VALUES (?, ?, 'published', ?, ?, ?)
		ON CONFLICT(id, version) DO UPDATE SET
			status = excluded.status,
			payload = excluded.payload,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at`, id, newV, payload, by, now()); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM definitions WHERE id = ? AND status = 'draft'`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// Rollback re-publishes a previous published version as a brand new version.
func (s *Store) Rollback(id string, targetVersion int, by string) error {
	var payload string
	err := s.db.QueryRow(`SELECT payload FROM definitions WHERE id = ? AND version = ? AND status = 'published'`, id, targetVersion).Scan(&payload)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("rollback %s: published version %d not found", id, targetVersion)
		}
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var maxV int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(version), ?) FROM definitions WHERE id = ? AND status = 'published'`, targetVersion, id).Scan(&maxV); err != nil {
		return err
	}
	newV := maxV + 1
	newPayload, err := bumpVersion(payload, newV)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO definitions(id, version, status, payload, updated_by, updated_at)
		VALUES (?, ?, 'published', ?, ?, ?)
		ON CONFLICT(id, version) DO UPDATE SET
			status = excluded.status,
			payload = excluded.payload,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at`, id, newV, newPayload, by, now()); err != nil {
		return err
	}
	return tx.Commit()
}

// Versions lists every version of the definition, newest first.
func (s *Store) Versions(id string) ([]VersionInfo, error) {
	rows, err := s.db.Query(`SELECT version, status, updated_by, updated_at
		FROM definitions WHERE id = ? ORDER BY version DESC, updated_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vs []VersionInfo
	for rows.Next() {
		var v VersionInfo
		if err := rows.Scan(&v.Version, &v.Status, &v.UpdatedBy, &v.UpdatedAt); err != nil {
			return nil, err
		}
		vs = append(vs, v)
	}
	return vs, rows.Err()
}

// DiffSummary returns the top-level keys whose JSON content differs between
// two published versions of a definition.
func (s *Store) DiffSummary(id string, newer, older int) ([]string, error) {
	newPayload, err := s.payloadAt(id, newer)
	if err != nil {
		return nil, err
	}
	oldPayload, err := s.payloadAt(id, older)
	if err != nil {
		return nil, err
	}

	var a, b map[string]any
	if err := json.Unmarshal([]byte(newPayload), &a); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(oldPayload), &b); err != nil {
		return nil, err
	}

	var changed []string
	for _, k := range []string{"id", "name", "dataset", "dimensions", "metrics", "layout_opts", "style_rules", "overrides", "conditional_formats"} {
		if digestOf(a[k]) != digestOf(b[k]) {
			changed = append(changed, k)
		}
	}
	return changed, nil
}

// payloadAt returns the payload of a specific published version.
func (s *Store) payloadAt(id string, v int) (string, error) {
	var payload string
	err := s.db.QueryRow(`SELECT payload FROM definitions WHERE id = ? AND version = ? AND status = 'published'`, id, v).Scan(&payload)
	if err != nil {
		return "", err
	}
	return payload, nil
}

// bumpVersion rewrites the version field of a JSON payload.
func bumpVersion(payload string, newV int) (string, error) {
	var m map[string]any
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return "", err
	}
	m["version"] = newV
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// digestOf renders a JSON value into a comparable string.
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
