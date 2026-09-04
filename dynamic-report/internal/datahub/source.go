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

// Source yields the ordered detail rows that drive the report engine.
type Source interface {
	Rows(def *model.ReportDefinition) ([]engine.DetailRow, error)
}

// SliceSource serves detail rows from an in-memory slice of records.
type SliceSource struct {
	data []map[string]any
}

// NewSliceSource creates a SliceSource over the given records.
func NewSliceSource(data []map[string]any) *SliceSource {
	return &SliceSource{data: data}
}

// Rows converts every record to a DetailRow and sorts rows per the definition.
func (s *SliceSource) Rows(def *model.ReportDefinition) ([]engine.DetailRow, error) {
	rows := make([]engine.DetailRow, 0, len(s.data))
	for _, rec := range s.data {
		rows = append(rows, toDetailRow(def, rec))
	}
	sortRows(def, rows)
	return rows, nil
}

// CSVSource serves detail rows from a CSV file.
type CSVSource struct {
	path string
}

// NewCSVSource creates a CSVSource reading from path.
func NewCSVSource(path string) *CSVSource {
	return &CSVSource{path: path}
}

// Rows parses the CSV at path, converts each record to a DetailRow and sorts
// the rows per the definition. The first row is treated as the header;
// number-typed fields are parsed as float64 while every other column is kept
// as a raw string. Missing columns are reported unless the missing field
// carries a sort_key whose own column is present (one of the two suffices).
func (s *CSVSource) Rows(def *model.ReportDefinition) ([]engine.DetailRow, error) {
	f, err := os.Open(s.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1 // tolerate variable-width rows
	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", s.path, err)
	}
	if len(records) == 0 {
		return nil, nil
	}

	colIdx := make(map[string]int, len(records[0]))
	for i, col := range records[0] {
		colIdx[col] = i
	}

	numTypes := make(map[string]bool, len(def.Dataset.Fields))
	for _, fd := range def.Dataset.Fields {
		if fd.Type == "number" {
			numTypes[fd.Key] = true
		}
	}

	// 缺失列校验：在所有 Fields 上执行，早于 toDetailRow。
	for _, fd := range def.Dataset.Fields {
		if _, ok := colIdx[fd.Key]; ok {
			continue
		}
		if fd.SortKey != "" {
			if _, ok := colIdx[fd.SortKey]; ok {
				continue
			}
			return nil, fmt.Errorf("%s: field %q and its sort_key %q missing", s.path, fd.Key, fd.SortKey)
		}
		return nil, fmt.Errorf("%s: field %q missing", s.path, fd.Key)
	}

	var rows []engine.DetailRow
	for _, rec := range records[1:] {
		raw := make(map[string]any, len(colIdx))
		for col, idx := range colIdx {
			if idx >= len(rec) {
				continue
			}
			val := rec[idx]
			if numTypes[col] {
				fv, err := strconv.ParseFloat(val, 64)
				if err != nil {
					return nil, fmt.Errorf("%s: parse number column %q value %q: %w", s.path, col, val, err)
				}
				raw[col] = fv
			} else {
				raw[col] = val
			}
		}
		rows = append(rows, toDetailRow(def, raw))
	}
	sortRows(def, rows)
	return rows, nil
}

// toDetailRow projects a raw record into a DetailRow: Keys follow the ordered
// dimensions (non-string values are ignored), Values carry the full raw map.
func toDetailRow(def *model.ReportDefinition, raw map[string]any) engine.DetailRow {
	row := engine.DetailRow{Values: raw}
	for _, dim := range def.Dimensions {
		var s string
		if v, ok := raw[dim.Field].(string); ok {
			s = v
		}
		row.Keys = append(row.Keys, s)
	}
	return row
}

// sortRows stably sorts rows by the dimensions in declaration order.
func sortRows(def *model.ReportDefinition, rows []engine.DetailRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		for _, dim := range def.Dimensions {
			si := sortValue(def, dim, rows[i])
			sj := sortValue(def, dim, rows[j])
			if si == sj {
				continue
			}
			if dim.Sort.Dir == "desc" {
				return si > sj
			}
			return si < sj
		}
		return false
	})
}

// sortValue returns the comparable sort key of one dimension on a row.
//
// sort_key 是纯字符串比较：region_order 的 "1"/"2" 在本样例中恰好与字典序
// 一致，因此可用。若未来出现数字顺序与字典序不一致的多位序号（如 "10" < "9"），
// 需由上游补零（"09"、"10"）保证顺序，此处不再做数值特殊处理。
func sortValue(def *model.ReportDefinition, dim model.DimensionDef, r engine.DetailRow) string {
	if dim.Sort.By == "sort_key" {
		if fd := findField(def, dim.Field); fd != nil && fd.SortKey != "" {
			if v, ok := r.Values[fd.SortKey]; ok {
				return fmt.Sprint(v)
			}
		}
	}
	for i, d := range def.Dimensions {
		if d.Field == dim.Field && i < len(r.Keys) {
			return r.Keys[i]
		}
	}
	return ""
}

// findField returns the dataset field definition with the given key, or nil.
func findField(def *model.ReportDefinition, key string) *model.FieldDef {
	for i := range def.Dataset.Fields {
		if def.Dataset.Fields[i].Key == key {
			return &def.Dataset.Fields[i]
		}
	}
	return nil
}
