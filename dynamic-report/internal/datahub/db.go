package datahub

import (
	"database/sql"
	"fmt"
	"strings"

	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
)

// rowNoCol 是内层子查询用窗口函数捕获的源表自然行号列（血缘抽样用）。
const rowNoCol = "__row_no"

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
	// 4) 查询：内层 ROW_NUMBER() 捕获源表自然行号（血缘 RowNo 用），外层 ORDER BY 下推。
	//    表名不做引号转义（由数据源定义方保证）；列名已白名单校验。
	query := fmt.Sprintf(
		"SELECT * FROM (SELECT ROW_NUMBER() OVER () AS %s, %s FROM %s)%s",
		rowNoCol, strings.Join(cols, ", "), s.table, orderBY,
	)
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("db source query: %w", err)
	}
	defer rows.Close()

	var out []engine.DetailRow
	for rows.Next() {
		vals := make([]any, len(cols)+1) // +1 为 rowNoCol
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		raw := make(map[string]any, len(cols))
		for i, c := range cols {
			raw[c] = normalized(vals[i+1])
		}
		row := toDetailRow(def, raw)
		if n, ok := vals[0].(int64); ok {
			row.RowNo = int(n)
		}
		out = append(out, row)
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
