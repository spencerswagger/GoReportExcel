package render

import (
	"fmt"
	"io"

	"github.com/xuri/excelize/v2"

	"dynamic-report/internal/model"
	"dynamic-report/internal/schema"
	"dynamic-report/internal/style"
)

// borderStyleCodes 映射 DSL 线型到 excelize v2.9.0 的 Border.Style 数值
// （即 OOXML ST_BorderStyle 枚举值，作为 styleBorders 数组下标：
// none=0 thin=1 medium=2 dashed=3 dotted=4 thick=5 double=6 hair=7...）。
var borderStyleCodes = map[string]int{
	"thin":   1,
	"medium": 2,
	"dashed": 3,
	"thick":  5,
	"double": 6,
	"hair":   7,
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

// Render 把 RenderSchema 渲染为 .xlsx 并写入 w。
//
// 样式策略：字典中的每个条目按 body 字体（BodyFont）注册为 excelize 样式；
// 表头单独按 HeaderFont 注册一个 header 样式，header 行单元格统一使用该
// 样式，避免依赖 schema 侧"第一个 intern 即 header"的命名约定。
// 单元格写入顺序关键（spike V2）：先 SetCellValue（缓存值）再
// SetCellFormula（公式），保证回读时公式与缓存值双写并存。
func Render(def *model.ReportDefinition, s *schema.RenderSchema, w io.Writer) error {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)

	// 1) 样式字典 → excelize.NewStyle（body 字体基座）。
	styleIDs := make(map[string]int, len(s.Styles))
	for id, st := range s.Styles {
		sid, err := f.NewStyle(toExcelStyle(def, st, false))
		if err != nil {
			return fmt.Errorf("new style %s: %w", id, err)
		}
		styleIDs[id] = sid
	}
	// 表头样式：HeaderFont 基座 + Bold 取或。
	headerSID, err := f.NewStyle(toExcelStyle(def, style.ResolvedStyle{Bold: def.BaseStyles.HeaderFont.Bold}, true))
	if err != nil {
		return fmt.Errorf("new header style: %w", err)
	}

	// 2) 列宽。
	for _, c := range s.Cols {
		axis := ColumnName(c.Idx + 1)
		if err := f.SetColWidth(sheet, axis, axis, c.Width); err != nil {
			return err
		}
	}

	// 3) 逐行逐格：先值后公式，最后应用样式。
	for _, row := range s.Rows {
		for _, cell := range row.Cells {
			axis := fmt.Sprintf("%s%d", ColumnName(cell.Col+1), row.Idx)
			if cell.Value != nil {
				if err := f.SetCellValue(sheet, axis, cell.Value); err != nil {
					return err
				}
			}
			if cell.Formula != "" {
				if err := f.SetCellFormula(sheet, axis, cell.Formula); err != nil {
					return err
				}
			}
			sid, ok := styleIDs[cell.Style]
			if !ok {
				return fmt.Errorf("unknown style id %q", cell.Style)
			}
			if row.Type == "header" {
				sid = headerSID
			}
			if err := f.SetCellStyle(sheet, axis, axis, sid); err != nil {
				return err
			}
		}
	}

	// 4) 合并单元格。
	for _, m := range s.Merges {
		topLeft := fmt.Sprintf("%s%d", ColumnName(m.C), m.R1)
		bottomRight := fmt.Sprintf("%s%d", ColumnName(m.C), m.R2)
		if err := f.MergeCell(sheet, topLeft, bottomRight); err != nil {
			return err
		}
	}

	// 5) 冻结表头与维度列，隐藏网格线。
	ndim := len(def.Dimensions)
	panes := &excelize.Panes{
		Freeze: true,
		YSplit: 1,
		XSplit: ndim,
	}
	if ndim == 0 {
		panes.TopLeftCell = "A2"
		panes.ActivePane = "bottomLeft"
	} else {
		panes.TopLeftCell = fmt.Sprintf("%s2", ColumnName(ndim+1))
		panes.ActivePane = "bottomRight"
	}
	if err := f.SetPanes(sheet, panes); err != nil {
		return err
	}
	showGrid := false
	if err := f.SetSheetView(sheet, 0, &excelize.ViewOptions{ShowGridLines: &showGrid}); err != nil {
		return err
	}

	return f.Write(w)
}

// toExcelStyle 把 ResolvedStyle 与基础字体转换为 excelize.Style。
// isHeader 决定字体基座取 HeaderFont 还是 BodyFont；Bold 取基座与规则
// 命中值的或。
func toExcelStyle(def *model.ReportDefinition, st style.ResolvedStyle, isHeader bool) *excelize.Style {
	fontSpec := def.BaseStyles.BodyFont
	if isHeader {
		fontSpec = def.BaseStyles.HeaderFont
	}
	es := &excelize.Style{
		Font: &excelize.Font{
			Bold:   fontSpec.Bold || st.Bold,
			Family: fontSpec.Name,
			Size:   float64(fontSpec.Size),
		},
	}
	if st.FontColor != "" {
		es.Font.Color = st.FontColor
	}
	if st.Fill != "" {
		es.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{st.Fill}}
	}
	if st.Indent > 0 || isHeader {
		es.Alignment = &excelize.Alignment{Indent: st.Indent, WrapText: isHeader}
	}
	var borders []excelize.Border
	addBorder := func(side, typ string) {
		if side == "" {
			return
		}
		code, ok := borderStyleCodes[side]
		if !ok {
			return
		}
		borders = append(borders, excelize.Border{Type: typ, Style: code, Color: "FF000000"})
	}
	addBorder(st.BorderLeft, "left")
	addBorder(st.BorderRight, "right")
	addBorder(st.BorderTop, "top")
	addBorder(st.BorderBottom, "bottom")
	es.Border = borders
	return es
}
