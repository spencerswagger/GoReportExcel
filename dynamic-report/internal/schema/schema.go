package schema

import (
	"fmt"
	"math"
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

// PageSetupInfo 描述打印/导出时的页面设置。
type PageSetupInfo struct {
	Orientation      string `json:"orientation,omitempty"`
	FitToWidth       int    `json:"fit_to_width,omitempty"`
	RepeatHeaderRows int    `json:"repeat_header_rows,omitempty"`
}

// CFInfo 描述一条已展开的条件格式（含目标单元格区间与统计信息）。
type CFInfo struct {
	ID     string               `json:"id"`
	Kind   string               `json:"kind"`
	Color  string               `json:"color,omitempty"`
	N      int                  `json:"n,omitempty"`
	Style  model.StylePatchJSON `json:"style,omitempty"`
	Ranges []string             `json:"ranges"`
	Stats  *CFStats             `json:"stats,omitempty"`
}

// CFStats 描述条件格式覆盖区间的数值统计（data_bar/color_scale 用）。
type CFStats struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

// ExplainDTO 描述一条命中样式规则及其自然语言原因。
type ExplainDTO struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// CellTraceDTO 描述单元格的数据血缘（来源条数与抽样行号）。
type CellTraceDTO struct {
	SourceCount int   `json:"source_count"`
	SampleRows  []int `json:"sample_rows,omitempty"`
}

// CellDTO 是渲染层的一个单元格。
type CellDTO struct {
	Col      int           `json:"col"`
	CellID   string        `json:"cell_id"`
	Value    any           `json:"value"`
	Display  string        `json:"display"`
	Formula  string        `json:"formula,omitempty"`
	Style    string        `json:"style"`
	RuleHits []string      `json:"rule_hits,omitempty"`
	Explains []ExplainDTO  `json:"explains,omitempty"`
	Trace    *CellTraceDTO `json:"trace,omitempty"`
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
	SchemaVersion      int                            `json:"schema_version"`
	Report             ReportInfo                     `json:"report"`
	Cols               []ColInfo                      `json:"cols"`
	Styles             map[string]style.ResolvedStyle `json:"styles"`
	Merges             []MergeInfo                    `json:"merges"`
	Rows               []RowDTO                       `json:"rows"`
	PageSetup          *PageSetupInfo                 `json:"page_setup,omitempty"`
	ConditionalFormats []CFInfo                       `json:"conditional_formats,omitempty"`
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
			var st style.ResolvedStyle
			var explains []ExplainDTO
			var err error
			if trace {
				st, explains, err = tracedResolve(se, &ctx)
				if err != nil {
					return nil, err
				}
			} else {
				st, _, err = se.Resolve(ctx)
				if err != nil {
					return nil, err
				}
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
				RuleHits: ruleHitsFrom(trace, explains),
				Explains: explains,
				Trace:    toTraceDTO(cell.Trace),
			})
		}
		if rowHeight > 0 {
			dto.Height = rowHeight
		}
		s.Rows = append(s.Rows, dto)
	}
	s.PageSetup = buildPageSetup(def)
	s.ConditionalFormats = buildConditionalFormats(def, l, ndim)
	return s, nil
}

// ruleHitsFrom 在 trace 模式下从解释列表提取命中规则 ID，非 trace 时返回 nil。
// 保持前端契约：RuleHits 仅在预览模式输出。
func ruleHitsFrom(trace bool, explains []ExplainDTO) []string {
	if !trace {
		return nil
	}
	out := make([]string, 0, len(explains))
	for _, x := range explains {
		out = append(out, x.ID)
	}
	return out
}

// tracedResolve 调用引擎的带解释求值，并把 RuleExplain 转换为 DTO。
func tracedResolve(e *style.Engine, ctx *style.CellContext) (style.ResolvedStyle, []ExplainDTO, error) {
	st, ex, err := e.ResolveTraced(ctx)
	if err != nil {
		return st, nil, err
	}
	out := make([]ExplainDTO, 0, len(ex))
	for _, x := range ex {
		out = append(out, ExplainDTO{ID: x.ID, Reason: x.Reason})
	}
	return st, out, nil
}

// toTraceDTO 把引擎血缘信息转换为 DTO；无血缘时返回 nil。
func toTraceDTO(t *engine.CellTrace) *CellTraceDTO {
	if t == nil {
		return nil
	}
	return &CellTraceDTO{SourceCount: t.SourceCount, SampleRows: t.SampleRows}
}

// buildPageSetup 从定义提取打印页面设置；未配置时返回 nil。
func buildPageSetup(def *model.ReportDefinition) *PageSetupInfo {
	if def.LayoutOpts.Print == nil {
		return nil
	}
	return &PageSetupInfo{
		Orientation:      def.LayoutOpts.Print.Orientation,
		FitToWidth:       def.LayoutOpts.Print.FitToWidth,
		RepeatHeaderRows: def.LayoutOpts.Print.RepeatHeaderRows,
	}
}

// cfGroupLimit 是 per_group 条件格式允许的最大分组数；超过则退化为整表单区间。
const cfGroupLimit = 200

// buildConditionalFormats 把定义中的条件格式展开为渲染层 DTO：
//   - 按 metric 定位目标列，生成 Excel 区间（物理行号，1-based）；
//   - per_group 时按叶子维度组逐组生成区间（行扫描 FirstOfDepth/LastOfDepth，
//     区间收束到组内最后一条明细行（不含小计行），避免 top_n 被小计和值污染；
//     覆盖单行组，因为合并区间只覆盖 ≥2 行的组）；
//   - data_bar/color_scale 附带区间数值统计。
func buildConditionalFormats(def *model.ReportDefinition, l *engine.Layout, ndim int) []CFInfo {
	if len(l.Rows) == 0 {
		return nil
	}
	var out []CFInfo
	for _, cf := range def.ConditionalFormats {
		colIdx := -1
		for mi, m := range def.Metrics {
			if m.Field == cf.Scope.Metric {
				colIdx = ndim + mi
			}
		}
		if colIdx < 0 {
			continue
		}
		colLetter := engine.ColumnName(colIdx + 1)
		info := CFInfo{ID: cf.ID, Kind: cf.Kind, Color: cf.Color, N: cf.N, Style: cf.Style}

		type groupBand struct{ from, to int }
		var bands []groupBand
		if cf.Scope.PerGroup {
			// 按行扫描叶子维度组边界（FirstOfDepth/LastOfDepth），
			// 区间收束到组内最后一条明细行（不含小计行），避免 top_n 被小计和值污染；
			// 覆盖单行组（合并区间只覆盖 ≥2 行组，会漏掉单行组）。
			leaf := ndim - 1
			if leaf >= 0 {
				start := -1
				for i, r := range l.Rows {
					if r.Type == style.RowDetail && len(r.FirstOfDepth) > leaf && r.FirstOfDepth[leaf] {
						start = i
					}
					if start >= 0 && len(r.LastOfDepth) > leaf && r.LastOfDepth[leaf] {
						bands = append(bands, groupBand{start, i - 1})
						start = -1
					}
				}
			}
			if len(bands) == 0 {
				bands = append(bands, groupBand{0, len(l.Rows) - 1})
			}
			if len(bands) > cfGroupLimit {
				bands = []groupBand{{0, len(l.Rows) - 1}}
			}
		} else {
			bands = []groupBand{{0, len(l.Rows) - 1}}
		}
		for _, b := range bands {
			info.Ranges = append(info.Ranges, fmt.Sprintf("%s%d:%s%d", colLetter, b.from+2, colLetter, b.to+2))
		}
		if cf.Kind == "data_bar" || cf.Kind == "color_scale" {
			minV, maxV := math.Inf(1), math.Inf(-1)
			found := false
			for _, b := range bands {
				for i := b.from; i <= b.to; i++ {
					if i < len(l.Rows) && colIdx < len(l.Rows[i].Cells) {
						if f, ok := toFloat(l.Rows[i].Cells[colIdx].Value); ok {
							found = true
							if f < minV {
								minV = f
							}
							if f > maxV {
								maxV = f
							}
						}
					}
				}
			}
			if found {
				info.Stats = &CFStats{Min: minV, Max: maxV}
			}
		}
		out = append(out, info)
	}
	return out
}

// PageRows 按行窗口切片（窗口按"数据行序号"计，header 恒保留在首位）。
// [from,to) 是数据行（即 Rows[1:]）的下标区间；超出可用行数时静默截断（与前端模式一致）。
func (s *RenderSchema) PageRows(from, to int) error {
	last := len(s.Rows) - 1 // 数据行总数（Rows[0] 为 header）
	if last < 0 {
		return fmt.Errorf("empty schema")
	}
	if from < 0 {
		from = 0
	}
	if from > last {
		from = last
	}
	if to < from {
		to = from
	}
	if to > last {
		to = last
	}
	body := s.Rows[1:]
	s.Rows = append([]RowDTO{s.Rows[0]}, body[from:to]...)
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
