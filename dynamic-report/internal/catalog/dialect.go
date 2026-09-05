package catalog

import (
	"strings"
)

// Dialect identifies the SQL flavour used by the definitions store.
type Dialect int

const (
	// DialectSQLite uses '?' positional placeholders (modernc.org/sqlite).
	DialectSQLite Dialect = iota
	// DialectPostgres uses $1..$N positional placeholders (pgx / lib/pq).
	DialectPostgres
)

// String returns a human-readable name for logging and flags.
func (d Dialect) String() string {
	switch d {
	case DialectPostgres:
		return "postgres"
	default:
		return "sqlite"
	}
}

// Rebind converts '?' placeholders into the dialect's positional style.
// SQLite keeps '?'; PostgreSQL rewrites to $1, $2, … in order of appearance.
// The store SQL contains no string/comment literals with '?', so a plain
// byte scan is safe.
func (d Dialect) Rebind(query string) string {
	if d != DialectPostgres {
		return query
	}
	var b strings.Builder
	b.Grow(len(query) + 8)
	n := 0
	for i := 0; i < len(query); i++ {
		if query[i] == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(itoa(n))
		} else {
			b.WriteByte(query[i])
		}
	}
	return b.String()
}

// itoa is a tiny non-allocating-ish int renderer for placeholders (n < 1e4).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [6]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// DialectFromDSN guesses the dialect from a connection string:
//   - "postgres://…" / "postgresql://…" / "postgres:" or a plain libpq DSN
//     containing "host=…" → DialectPostgres
//   - anything else (a file path, ":memory:", "file:…") → DialectSQLite
func DialectFromDSN(dsn string) Dialect {
	trimmed := strings.TrimSpace(dsn)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "postgres://") ||
		strings.HasPrefix(lower, "postgresql://") ||
		strings.HasPrefix(lower, "postgres:") ||
		(strings.Contains(lower, "host=") && strings.Contains(lower, "dbname=")) {
		return DialectPostgres
	}
	return DialectSQLite
}

// PostgresDriver is the database/sql driver name registered by pgx.
const PostgresDriver = "pgx"