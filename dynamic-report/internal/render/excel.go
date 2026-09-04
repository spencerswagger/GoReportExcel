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
		es, err := toExcelStyle(def, st, false)
		if err != nil {
			return fmt.Errorf("new style %s: %w", id, err)
		}
		sid, err := f.NewStyle(es)
		if err != nil {
			return fmt.Errorf("new style %s: %w", id, err)
		}
		styleIDs[id] = sid
	}
	// 表头样式：HeaderFont 基座 + Bold 取或。
	headerES, err := toExcelStyle(def, style.ResolvedStyle{Bold: def.BaseStyles.HeaderFont.Bold}, true)
	if err != nil {
		return fmt.Errorf("new header style: %w", err)
	}
	headerSID, err := f.NewStyle(headerES)
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

	// 3) 逐行逐格：先行高后单元格（先值后公式，最后应用样式）。
	for _, row := range s.Rows {
		if row.Height > 0 {
			if err := f.SetRowHeight(sheet, row.Idx, row.Height); err != nil {
				return err
			}
		}
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

	// 5) 条件格式注入（轨道 B；同一 rangeRef 合并为一次调用，spike V1 结论）。
	if err := applyConditionalFormats(f, sheet, s.ConditionalFormats); err != nil {
		return err
	}

	// 6) 打印设置（重复表头行需带 Scope，spike V3 结论）。
	if err := applyPageSetup(f, sheet, s.PageSetup); err != nil {
		return err
	}

	// 7) 冻结表头与维度列，隐藏网格线。
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
// 命中值的或。未知线型属于防御性错误（DSL 校验已限定 6 种线型）。
func toExcelStyle(def *model.ReportDefinition, st style.ResolvedStyle, isHeader bool) (*excelize.Style, error) {
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
	switch {
	case st.Indent > 0:
		// indent 只在 horizontal=left/right/distributed 下生效，必须显式给
		// Horizontal=left 否则分组缩进在 Excel 中不生效；Vertical 与
		// WrapText 保证缩进行内文字垂直居中、自动换行。
		es.Alignment = &excelize.Alignment{Indent: st.Indent, Horizontal: "left", Vertical: "center", WrapText: true}
	case isHeader:
		es.Alignment = &excelize.Alignment{Vertical: "center", WrapText: true}
	}
	var borders []excelize.Border
	addBorder := func(lineStyle, borderType string) error {
		if lineStyle == "" {
			return nil
		}
		code, ok := borderStyleCodes[lineStyle]
		if !ok {
			return fmt.Errorf("unknown border style %q", lineStyle)
		}
		// excelize getPaletteColor 会对 6 位色值自动补 "FF" 前缀；写
		// "#000000" 而非 "FF000000"，避免生成 10 位非法 ARGB。
		borders = append(borders, excelize.Border{Type: borderType, Style: code, Color: "#000000"})
		return nil
	}
	if err := addBorder(st.BorderLeft, "left"); err != nil {
		return nil, err
	}
	if err := addBorder(st.BorderRight, "right"); err != nil {
		return nil, err
	}
	if err := addBorder(st.BorderTop, "top"); err != nil {
		return nil, err
	}
	if err := addBorder(st.BorderBottom, "bottom"); err != nil {
		return nil, err
	}
	es.Border = borders
	return es, nil
}

// applyConditionalFormats 注入条件格式；同 kind+rangeRef 合并一次
// SetConditionalFormat（spike V1：同一 rangeRef 重复调用会整体覆盖旧规则，
// 必须合并进一次调用的 opts 数组）。
func applyConditionalFormats(f *excelize.File, sheet string, cfs []schema.CFInfo) error {
	// range → []excelize.ConditionalFormatOptions 分组
	byRange := map[string][]excelize.ConditionalFormatOptions{}
	var order []string
	addOpt := func(rng string, opt excelize.ConditionalFormatOptions) {
		if _, ok := byRange[rng]; !ok {
			order = append(order, rng)
		}
		byRange[rng] = append(byRange[rng], opt)
	}
	for _, cf := range cfs {
		for _, rng := range cf.Ranges {
			var opt excelize.ConditionalFormatOptions
			switch cf.Kind {
			case "data_bar":
				// v2.9.0 校验要求 Criteria 非空，且 data_bar 需显式
				// MinType/MaxType（spike V1 结论）。
				opt = excelize.ConditionalFormatOptions{
					Type: "data_bar", Criteria: "=",
					MinType: "min", MaxType: "max",
					BarColor: cf.Color,
				}
			case "color_scale":
				// v2.9.0 无 "color_scale" 类型（validType 无此键），
				// 须用 "2_color_scale"（spike V1 结论）。CFInfo 仅携带
				// 单一 Color，min/max 两端同色（退化但合法）。
				opt = excelize.ConditionalFormatOptions{
					Type: "2_color_scale", Criteria: "=",
					MinType: "min", MaxType: "max",
					MinColor: cf.Color, MaxColor: cf.Color,
				}
			case "top_n":
				opt = excelize.ConditionalFormatOptions{Type: "top", Criteria: ">", Value: fmt.Sprint(cf.N - 1)}
				if cf.Style.Fill != nil {
					st, err := f.NewConditionalStyle(&excelize.Style{
						Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{cf.Style.Fill.Color}},
						Font: &excelize.Font{Bold: cf.Style.Bold},
					})
					if err != nil {
						return err
					}
					opt.Format = &st
				}
			default:
				continue
			}
			addOpt(rng, opt)
		}
	}
	for _, rng := range order {
		if err := f.SetConditionalFormat(sheet, rng, byRange[rng]); err != nil {
			return fmt.Errorf("conditional format %s: %w", rng, err)
		}
	}
	return nil
}

// applyPageSetup 应用打印设置：方向、缩放到一页宽、重复表头行。
func applyPageSetup(f *excelize.File, sheet string, ps *schema.PageSetupInfo) error {
	if ps == nil {
		return nil
	}
	var orient string
	switch ps.Orientation {
	case "landscape":
		orient = "landscape"
	default:
		orient = "portrait"
	}
	if ps.FitToWidth > 0 {
		if err := f.SetPageLayout(sheet, &excelize.PageLayoutOptions{
			Orientation: &orient, FitToWidth: &ps.FitToWidth,
		}); err != nil {
			return err
		}
	} else if ps.Orientation != "" {
		if err := f.SetPageLayout(sheet, &excelize.PageLayoutOptions{Orientation: &orient}); err != nil {
			return err
		}
	}
	if ps.RepeatHeaderRows > 0 {
		if err := f.SetDefinedName(&excelize.DefinedName{
			Name: "_xlnm.Print_Titles", RefersTo: fmt.Sprintf("%s!$1:$%d", sheet, ps.RepeatHeaderRows),
			Scope: sheet, // 必须带 Scope（spike V3）
		}); err != nil {
			return err
		}
	}
	return nil
}
