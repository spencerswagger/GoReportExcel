package catalog

import "testing"

func TestDialectRebind(t *testing.T) {
	cases := []struct {
		name  string
		d     Dialect
		query string
		want  string
	}{
		{"sqlite passthrough", DialectSQLite,
			`SELECT id FROM definitions WHERE id = ? AND version = ?`,
			`SELECT id FROM definitions WHERE id = ? AND version = ?`},
		{"postgres renumbers", DialectPostgres,
			`SELECT id FROM definitions WHERE id = ? AND version = ?`,
			`SELECT id FROM definitions WHERE id = $1 AND version = $2`},
		{"no placeholders", DialectPostgres,
			`DELETE FROM definitions WHERE 1=0`,
			`DELETE FROM definitions WHERE 1=0`},
		{"interleaved text", DialectPostgres,
			`INSERT INTO t(a, b) VALUES (?, ?)
			 ON CONFLICT(id) DO UPDATE SET b = excluded.b WHERE t.status = ?`,
			`INSERT INTO t(a, b) VALUES ($1, $2)
			 ON CONFLICT(id) DO UPDATE SET b = excluded.b WHERE t.status = $3`},
		{"repeated arg count", DialectPostgres,
			`SELECT COALESCE(MAX(version), ?) FROM definitions WHERE id = ?`,
			`SELECT COALESCE(MAX(version), $1) FROM definitions WHERE id = $2`},
		{"empty", DialectPostgres, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.d.Rebind(c.query); got != c.want {
				t.Errorf("Rebind(%q) = %q, want %q", c.query, got, c.want)
			}
		})
	}
}

func TestDialectFromDSN(t *testing.T) {
	cases := []struct {
		dsn  string
		want Dialect
	}{
		{"catalog.db", DialectSQLite},
		{":memory:", DialectSQLite},
		{"file:/var/lib/goreport/catalog.db", DialectSQLite},
		{"postgres://user:pass@localhost:5432/goreport", DialectPostgres},
		{"postgresql://user@host/db?sslmode=disable", DialectPostgres},
		{"postgres:host=localhost dbname=goreport sslmode=disable", DialectPostgres},
		{"host=localhost port=5432 dbname=goreport user=u", DialectPostgres},
		{"Host=localhost DBName=goreport", DialectPostgres}, // case-insensitive
	}
	for _, c := range cases {
		t.Run(c.dsn, func(t *testing.T) {
			if got := DialectFromDSN(c.dsn); got != c.want {
				t.Errorf("DialectFromDSN(%q) = %v, want %v", c.dsn, got, c.want)
			}
		})
	}
}

func TestDialectString(t *testing.T) {
	if DialectSQLite.String() != "sqlite" || DialectPostgres.String() != "postgres" {
		t.Fatalf("unexpected dialect names: %v / %v", DialectSQLite, DialectPostgres)
	}
}