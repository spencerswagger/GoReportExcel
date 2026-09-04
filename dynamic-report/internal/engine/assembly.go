package engine

import (
	"fmt"

	"dynamic-report/internal/model"
)

// subtotalFnCodes 映射聚合函数到 Excel SUBTOTAL 函数码。
// COUNT 使用码 3（COUNTA 语义：非空计数）。
var subtotalFnCodes = map[model.AggFunc]int{
	model.AggSum:   9,
	model.AggAvg:   1,
	model.AggCount: 3,
	model.AggMax:   4,
	model.AggMin:   5,
}

// SubtotalFormula 生成 =SUBTOTAL(code, colFrom:colTo)。
// SUBTOTAL 天然忽略区间内嵌套的 SUBTOTAL 行，多级小计不重复求值。
func SubtotalFormula(agg model.AggFunc, col string, from, to int) string {
	return fmt.Sprintf("=SUBTOTAL(%d,%s%d:%s%d)", subtotalFnCodes[agg], col, from, col, to)
}

// ColumnName 把 1-based 列号转换为 Excel 列名（1→A，27→AA）。
func ColumnName(n int) string {
	s := ""
	for n > 0 {
		n--
		s = string(rune('A'+n%26)) + s
		n /= 26
	}
	return s
}

// AssemblyPass（P3 装配遍）：把布局下标区间换算为物理行号并生成公式。
// 物理行 = 布局下标 + 2（第 1 行是表头）。小计与总计统一使用 SubRange 区间，
// 公式终点引用到 lastIdx（最后一条明细/小计行），天然不含总计行自身；
// 总计列位移已在 GroupStack.Finish 中通过区间 +1 补偿。
func AssemblyPass(def *model.ReportDefinition, l *Layout) {
	ndim := len(def.Dimensions)
	for _, row := range l.Rows {
		for ci := range row.Cells {
			cell := &row.Cells[ci]
			if !cell.HasRange {
				continue
			}
			m := def.Metrics[cell.MetricIdx]
			col := ColumnName(ndim + cell.MetricIdx + 1)
			to := cell.SubRange.ToIdx + 2
			cell.Formula = SubtotalFormula(m.Agg, col, cell.SubRange.FromIdx+2, to)
		}
	}
}
