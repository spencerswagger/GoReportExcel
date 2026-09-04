package engine

import (
	"unicode/utf8"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// GroupFirstRow/GroupLastRow 提供行级便捷标志：
// 有维度时取最内层深度；0 维度时退化为表级首/末行语义。
func (r *LayoutRow) GroupFirstRow() bool {
	if len(r.FirstOfDepth) == 0 {
		return r.sheetFirst
	}
	return r.FirstOfDepth[len(r.FirstOfDepth)-1]
}

func (r *LayoutRow) GroupLastRow() bool {
	if len(r.LastOfDepth) == 0 {
		return r.sheetLast
	}
	return r.LastOfDepth[len(r.LastOfDepth)-1]
}

// PositionPass（P1 位置遍）：
// 1) 计算每个深度组的行跨度，写 FirstOfDepth/LastOfDepth；
// 2) 跨度 >1 行生成合并区间，并清空非首行的维度值；
// 3) 统计列宽（显示宽度，CJK 计 2）。
func PositionPass(def *model.ReportDefinition, l *Layout) {
	ndim := len(def.Dimensions)
	n := len(l.Rows)
	for _, r := range l.Rows {
		if ndim > 0 {
			r.FirstOfDepth = make([]bool, ndim)
			r.LastOfDepth = make([]bool, ndim)
		}
	}
	if ndim == 0 {
		for i, r := range l.Rows {
			r.sheetFirst = i == 0
			r.sheetLast = i == n-1
		}
	}

	type span struct {
		depth int
		start int
	}
	var spans []*span
	pathOf := func(r *LayoutRow) []string {
		switch r.Type {
		case style.RowDetail:
			return r.GroupPath
		case style.RowSubtotal:
			return r.GroupPath[:r.Level+1]
		}
		return nil // total 行不属于任何组
	}
	close := func(s *span, end int) {
		// 组的末行（end）是该深度组的最后一行；区间内其它行不是。
		l.Rows[end].LastOfDepth[s.depth] = true
		if end > s.start {
			l.Merges = append(l.Merges, MergeRange{s.depth, s.start, end})
			for i := s.start + 1; i <= end; i++ {
				l.Rows[i].Cells[s.depth].Value = nil
			}
		}
	}
	for i, r := range l.Rows {
		path := pathOf(r)
		lcp := 0
		for lcp < len(spans) && lcp < len(path) {
			if l.Rows[spans[lcp].start].GroupPath[lcp] != path[lcp] {
				break
			}
			lcp++
		}
		for len(spans) > lcp {
			s := spans[len(spans)-1]
			spans = spans[:len(spans)-1]
			close(s, i-1) // 触发行不属于该组；组末行是其小计行
		}
		if r.Type == style.RowDetail {
			for d := lcp; d < len(path); d++ {
				spans = append(spans, &span{depth: d, start: i})
				r.FirstOfDepth[d] = true
			}
		}
	}
	for len(spans) > 0 { // 理论上 Finish 后无残留，防御性收尾
		s := spans[len(spans)-1]
		spans = spans[:len(spans)-1]
		close(s, n-1)
	}

	// 列宽统计
	ncols := ndim + len(def.Metrics)
	l.ColWidths = make([]float64, ncols)
	for c := 0; c < ncols; c++ {
		label := ""
		if c < ndim {
			label = def.Dimensions[c].Label
		} else {
			label = def.Metrics[c-ndim].Label
		}
		l.ColWidths[c] = float64(DisplayWidth(label))
	}
	for _, r := range l.Rows {
		for c := 0; c < ncols && c < len(r.Cells); c++ {
			if s, ok := r.Cells[c].Value.(string); ok {
				if w := float64(DisplayWidth(s)); w > l.ColWidths[c] {
					l.ColWidths[c] = w
				}
			}
		}
	}
}

// DisplayWidth 计算显示宽度：CJK 等全角字符计 2，其余计 1。
func DisplayWidth(s string) int {
	w := 0
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		if r >= 0x1100 && (r <= 0x115F || r == 0x2329 || r == 0x232A ||
			(r >= 0x2E80 && r <= 0xA4CF) || (r >= 0xAC00 && r <= 0xD7A3) ||
			(r >= 0xF900 && r <= 0xFAFF) || (r >= 0xFE30 && r <= 0xFE4F) ||
			(r >= 0xFF00 && r <= 0xFF60) || (r >= 0xFFE0 && r <= 0xFFE6)) {
			w += 2
		} else {
			w++
		}
	}
	return w
}
