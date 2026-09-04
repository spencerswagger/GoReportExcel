package render

import (
	"bytes"
	"strconv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/style"
)

// testDef 返回一个仅含基础字体的最小报告定义，供 toExcelStyle 单元测试使用。
func testDef(t *testing.T) *model.ReportDefinition {
	t.Helper()
	return &model.ReportDefinition{
		BaseStyles: model.BaseStyles{
			HeaderFont: model.FontSpec{Name: "Arial", Size: 11, Bold: true},
			BodyFont:   model.FontSpec{Name: "Arial", Size: 10},
		},
	}
}

// TestToExcelStyleBorderColor 回归 I2：边框颜色必须是 6 位 "#000000"，
// 否则 excelize getPaletteColor 再补 "FF" 前缀会形成 10 位非法 ARGB。
func TestToExcelStyleBorderColor(t *testing.T) {
	st := style.ResolvedStyle{
		BorderTop: "thin", BorderRight: "medium",
		BorderBottom: "thick", BorderLeft: "dashed",
	}
	es, err := toExcelStyle(testDef(t), st, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(es.Border) != 4 {
		t.Fatalf("borders = %d, want 4", len(es.Border))
	}
	for _, b := range es.Border {
		if b.Color != "#000000" {
			t.Errorf("border %s color = %q, want #000000", b.Type, b.Color)
		}
	}
}

// TestAlignIndent 回归 I3：Indent>0 时 Alignment 必须完整给出
// Horizontal=left、Vertical=center、WrapText=true，否则分组缩进在
// Excel 中不生效。
func TestAlignIndent(t *testing.T) {
	st := style.ResolvedStyle{Indent: 2}
	es, err := toExcelStyle(testDef(t), st, false)
	if err != nil {
		t.Fatal(err)
	}
	a := es.Alignment
	if a == nil {
		t.Fatal("Alignment is nil, want indent-aligned style")
	}
	if a.Horizontal != "left" {
		t.Errorf("Horizontal = %q, want left", a.Horizontal)
	}
	if a.Vertical != "center" {
		t.Errorf("Vertical = %q, want center", a.Vertical)
	}
	if a.Indent != 2 {
		t.Errorf("Indent = %d, want 2", a.Indent)
	}
	if !a.WrapText {
		t.Error("WrapText = false, want true")
	}
}

// TestHeaderAlignment 覆盖 I3 的表头分支：header 样式 Vertical=center、
// WrapText=true 且不引入 Indent。
func TestHeaderAlignment(t *testing.T) {
	es, err := toExcelStyle(testDef(t), style.ResolvedStyle{Bold: true}, true)
	if err != nil {
		t.Fatal(err)
	}
	a := es.Alignment
	if a == nil {
		t.Fatal("header Alignment is nil")
	}
	if a.Vertical != "center" {
		t.Errorf("header Vertical = %q, want center", a.Vertical)
	}
	if !a.WrapText {
		t.Error("header WrapText = false, want true")
	}
	if a.Indent != 0 {
		t.Errorf("header Indent = %d, want 0", a.Indent)
	}
}

// buildSchema 构建完整渲染管道并输出 xlsx 字节：
// model.Load → pipeline.BuildReport → Render。
func buildSchema(t *testing.T) (*model.ReportDefinition, []byte) {
	t.Helper()
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := pipeline.BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Render(def, s, &buf); err != nil {
		t.Fatal(err)
	}
	return def, buf.Bytes()
}

// cellValue 读取一个单元格并断言无错误。
func cellValue(t *testing.T, f *excelize.File, sheet, axis string) string {
	t.Helper()
	v, err := f.GetCellValue(sheet, axis)
	if err != nil {
		t.Fatalf("GetCellValue(%s): %v", axis, err)
	}
	return v
}

// cellFormula 读取一个单元格公式并断言无错误。
func cellFormula(t *testing.T, f *excelize.File, sheet, axis string) string {
	t.Helper()
	v, err := f.GetCellFormula(sheet, axis)
	if err != nil {
		t.Fatalf("GetCellFormula(%s): %v", axis, err)
	}
	return v
}

// TestRenderRoundTrip 渲染完整报表后回读内存 xlsx 并核对：
// 表头、排序后首行、公式（小计/总计）、合并区间、列宽。
//
// 物理行序（11 行）：1 表头 | 2 上海明细100 | 3 上海明细200 | 4 上海小计
// | 5 杭州明细 | 6 杭州小计 | 7 华东小计 | 8 北京明细 | 9 北京小计
// | 10 华北小计 | 11 总计。
func TestRenderRoundTrip(t *testing.T) {
	def, xlsx := buildSchema(t)
	if def == nil {
		t.Fatal("def is nil")
	}

	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("OpenReader: %v", err)
	}
	t.Cleanup(func() { f.Close() })
	sheet := "Sheet1"

	// 表头与排序后首条明细（region_order=1 华东 的上海 100）。
	if got := cellValue(t, f, sheet, "A1"); got != "大区" {
		t.Errorf("A1 = %q, want 大区", got)
	}
	if got := cellValue(t, f, sheet, "A2"); got != "华东" {
		t.Errorf("A2 = %q, want 华东", got)
	}
	if got := cellValue(t, f, sheet, "C2"); got != "100" {
		t.Errorf("C2 = %q, want 100", got)
	}

	// C 列整列核对行序（小计/总计为聚合缓存值；北京 400、华北小计 400，
	// 总计 1000，公式断言见下）。
	cCol := map[int]string{
		2: "100", 3: "200", 4: "300", 5: "300", 6: "300",
		7: "600", 8: "400", 9: "400", 10: "400", 11: "1000",
	}
	for r, want := range cCol {
		if got := cellValue(t, f, sheet, "C"+strconv.Itoa(r)); got != want {
			t.Errorf("C%d = %q, want %q", r, got, want)
		}
	}

	// 公式断言。
	// C4 上海小计：物理4，SubRange={0,1}+2 → C2:C3。
	if got := cellFormula(t, f, sheet, "C4"); got != "=SUBTOTAL(9,C2:C3)" {
		t.Errorf("C4 formula = %q, want =SUBTOTAL(9,C2:C3)", got)
	}
	// C11 总计：SubRange={0,8}，公式终点是布局 8（华北小计）物理10 → C2:C10。
	if got := cellFormula(t, f, sheet, "C11"); got != "=SUBTOTAL(9,C2:C10)" {
		t.Errorf("C11 formula = %q, want =SUBTOTAL(9,C2:C10)", got)
	}

	// 合并：城市列（B）上海组物理 2..4。
	merged, err := f.GetMergeCells(sheet)
	if err != nil {
		t.Fatalf("GetMergeCells: %v", err)
	}
	found := false
	for _, m := range merged {
		if m.GetStartAxis() == "B2" && m.GetEndAxis() == "B4" {
			found = true
		}
	}
	if !found {
		t.Errorf("merge B2:B4 not found, got: %v", merged)
	}

	// 列宽：A 列有显式宽度。
	w, err := f.GetColWidth(sheet, "A")
	if err != nil {
		t.Fatalf("GetColWidth: %v", err)
	}
	if w <= 0 {
		t.Errorf("A col width = %v, want > 0", w)
	}
}

// TestRenderConditionalFormatsAndPrint 渲染 overrides_test.json 后回读内存
// xlsx 并核对：条件格式存在（data_bar 颜色 638EC6）、打印标题 defined name。
//
// 说明：excelize v2.9.0 无公开 GetSheetXML，改用 GetConditionalFormats
// 回读条件格式（data_bar 的 BarColor 回读为 "#638EC6"）。
func TestRenderConditionalFormatsAndPrint(t *testing.T) {
	def, err := model.Load("../model/testdata/overrides_test.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := pipeline.BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Render(def, s, &buf); err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	// 条件格式存在：GetConditionalFormats 返回非空映射。
	cfs, err := f.GetConditionalFormats("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfs) == 0 {
		t.Fatal("no conditional formatting in sheet")
	}
	// 数据条颜色出现（data_bar 回读 BarColor="#638EC6"）。
	var barColor string
	for _, rules := range cfs {
		for _, r := range rules {
			if r.BarColor != "" {
				barColor = r.BarColor
			}
		}
	}
	if !strings.Contains(barColor, "638EC6") {
		t.Fatalf("data bar color missing in sheet, got %q", barColor)
	}
	// 打印标题 defined name。
	var printTitles bool
	for _, dn := range f.GetDefinedName() {
		if dn.Name == "_xlnm.Print_Titles" && dn.Scope == "Sheet1" {
			printTitles = true
		}
	}
	if !printTitles {
		t.Fatal("print titles defined name missing")
	}
}
