package schema

import (
	"fmt"
	"strconv"
	"strings"

	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// SchemaVersion 是 RenderSchema 的版本。
const SchemaVersion = 1

// ReportInfo 描述报告元信息。
type ReportInfo struct {
	ID         string `json:"id"`
	DefVersion int    `json:"def_version"`
	RowTotal   int    `json:"row_total"`
}

// ColInfo 描述一列的元数据。
type ColInfo struct {
	Idx    int     `json:"idx"`
	Role   string  `json:"role"` // dimension | metric
	Label  string  `json:"label"`
	Width  float64 `json:"width"`
	Align  string  `json:"align"`
	NumFmt string  `json:"num_fmt,omitempty"`
}

// MergeInfo 描述一个合并单元格区间（物理坐标，1-based）。
type MergeInfo struct {
	R1 int `json:"r1"`
	R2 int `json:"r2"`
	C  int `json:"c"`
}

// CellDTO 是渲染层的一个单元格。
type CellDTO struct {
	Col      int      `json:"col"`
	CellID   string   `json:"cell_id"`
	Value    any      `json:"value"`
	Display  string   `json:"display"`
	Formula  string   `json:"formula,omitempty"`
	Style    string   `json:"style"`
	RuleHits []string `json:"rule_hits,omitempty"`
}

// RowDTO 是渲染层的一行。
type RowDTO struct {
	Idx       int       `json:"idx"` // 物理行号（1-based）
	Type      string    `json:"type"`
	GroupPath []string  `json:"group_path,omitempty"`
	Seq       int       `json:"seq,omitempty"`
	Height    float64   `json:"height,omitempty"`
	Cells     []CellDTO `json:"cells"`
}

// RenderSchema 是把引擎布局转换为渲染器可直接消费的中间表示。
type RenderSchema struct {
	SchemaVersion int                            `json:"schema_version"`
	Report        ReportInfo                     `json:"report"`
	Cols          []ColInfo                      `json:"cols"`
	Styles        map[string]style.ResolvedStyle `json:"styles"`
	Merges        []MergeInfo                    `json:"merges"`
	Rows          []RowDTO                       `json:"rows"`
}

// Build 从物化布局构建 RenderSchema。
// trace=true 时输出 RuleHits（预览模式）。
func Build(def *model.ReportDefinition, l *engine.Layout, se *style.Engine, trace bool) (*RenderSchema, error) {
	ndim := len(def.Dimensions)
	ncols := ndim + len(def.Metrics)

	s := &RenderSchema{
		SchemaVersion: SchemaVersion,
		Report:        ReportInfo{ID: def.ID, DefVersion: def.Version, RowTotal: len(l.Rows)},
		Styles:        map[string]style.ResolvedStyle{},
	}
	dict := map[style.ResolvedStyle]string{}
	intern := func(st style.ResolvedStyle) string {
		if id, ok := dict[st]; ok {
			return id
		}
		id := fmt.Sprintf("s%d", len(dict)+1)
		dict[st] = id
		s.Styles[id] = st
		return id
	}

	for c := 0; c < ncols; c++ {
		info := ColInfo{Idx: c}
		if c < ndim {
			info.Role = "dimension"
			info.Label = def.Dimensions[c].Label
			info.Align = "left"
		} else {
			m := def.Metrics[c-ndim]
			info.Role = "metric"
			info.Label = m.Label
			info.Align = "right"
			info.NumFmt = def.BaseStyles.NumFormats[m.NumFmtRef]
		}
		w := float64(10)
		if c < len(l.ColWidths) {
			w = l.ColWidths[c] + 2
		}
		if w < 8 {
			w = 8
		}
		if w > 40 {
			w = 40
		}
		info.Width = w
		s.Cols = append(s.Cols, info)
	}
	for _, m := range l.Merges {
		s.Merges = append(s.Merges, MergeInfo{R1: m.FromIdx + 2, R2: m.ToIdx + 2, C: m.DimDepth + 1})
	}

	headerID := intern(style.ResolvedStyle{Bold: def.BaseStyles.HeaderFont.Bold})
	header := RowDTO{Idx: 1, Type: "header"}
	for c := 0; c < ncols; c++ {
		header.Cells = append(header.Cells, CellDTO{
			Col: c, CellID: fmt.Sprintf("r1c%d", c),
			Value: s.Cols[c].Label, Display: s.Cols[c].Label, Style: headerID,
		})
	}
	s.Rows = append(s.Rows, header)

	lastBodyIdx := len(l.Rows) + 1
	for i, row := range l.Rows {
		physRow := i + 2
		dto := RowDTO{
			Idx: physRow, Type: row.Type.String(),
			GroupPath: row.GroupPath, Seq: row.SeqInGroup, Height: row.Height,
		}
		// 行高是行级属性：engine 行高恒为 0，行高只能来自样式规则求值结果。
		// 循环单元格时收集该行首个 st.RowHeight>0 的值，循环结束后统一赋给 dto.Height。
		var rowHeight float64
		for c := 0; c < ncols && c < len(row.Cells); c++ {
			cell := row.Cells[c]
			ctx := buildCtx(def, row, physRow, c, lastBodyIdx)
			st, hits, err := se.Resolve(ctx)
			if err != nil {
				return nil, err
			}
			if st.RowHeight > 0 && rowHeight == 0 {
				rowHeight = st.RowHeight
			}
			numFmt := ""
			if cell.MetricIdx >= 0 {
				numFmt = def.BaseStyles.NumFormats[def.Metrics[cell.MetricIdx].NumFmtRef]
			}
			dto.Cells = append(dto.Cells, CellDTO{
				Col:      c,
				CellID:   fmt.Sprintf("r%dc%d", physRow, c),
				Value:    cell.Value,
				Display:  FormatDisplay(cell.Value, numFmt),
				Formula:  cell.Formula,
				Style:    intern(st),
				RuleHits: onlyIf(trace, hits),
			})
		}
		if rowHeight > 0 {
			dto.Height = rowHeight
		}
		s.Rows = append(s.Rows, dto)
	}
	return s, nil
}

// onlyIf 在 trace 模式下返回命中规则，否则返回 nil。
func onlyIf(trace bool, hits []string) []string {
	if trace {
		return hits
	}
	return nil
}

// buildCtx 根据布局行与单元格构造样式求值上下文。
func buildCtx(def *model.ReportDefinition, row *engine.LayoutRow, physRow, col, lastBodyIdx int) style.CellContext {
	ndim := len(def.Dimensions)
	cell := row.Cells[col]
	ctx := style.CellContext{
		Row: physRow, Col: col, RowType: row.Type,
		GroupPath: row.GroupPath, SeqInGroup: row.SeqInGroup,
		Value:         cell.Value,
		GroupFirstCol: col == 0,
		GroupLastCol:  col == ndim+len(def.Metrics)-1,
		SheetFirstRow: physRow == 2,
		SheetLastRow:  physRow == lastBodyIdx,
	}
	if cell.DimDepth >= 0 {
		ctx.ColRole = style.ColDimension
		ctx.DimDepth = cell.DimDepth
		ctx.GroupFirstRow = cell.DimDepth < len(row.FirstOfDepth) && row.FirstOfDepth[cell.DimDepth]
		ctx.GroupLastRow = cell.DimDepth < len(row.LastOfDepth) && row.LastOfDepth[cell.DimDepth]
	} else {
		ctx.ColRole = style.ColMetric
		ctx.DimDepth = -1
		ctx.MetricKey = def.Metrics[cell.MetricIdx].Field
		ctx.GroupFirstRow = row.GroupFirstRow()
		ctx.GroupLastRow = row.GroupLastRow()
	}
	return ctx
}

// FormatDisplay 按数字格式生成显示文本；格式单一事实源在后端。
func FormatDisplay(v any, numFmt string) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprint(v)
	}
	switch numFmt {
	case "#,##0.00":
		return thousands(strconv.FormatFloat(f, 'f', 2, 64))
	case "#,##0":
		return thousands(strconv.FormatFloat(f, 'f', 0, 64))
	default:
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
}

// thousands 从右往左每 3 位插入千分位逗号，保留小数部分与负号。
func thousands(s string) string {
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	intPart, frac := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, frac = s[:i], s[i:]
	}
	var b strings.Builder
	for i, ch := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	out := b.String() + frac
	if neg {
		return "-" + out
	}
	return out
}

// toFloat 把引擎中的数字值转换为 float64。
func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	return 0, false
}
