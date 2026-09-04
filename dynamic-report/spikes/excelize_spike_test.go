package spikes

import (
	"bytes"
	"fmt"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// V2 验证：公式 + 缓存值双写。
// 结论写入 FINDINGS.md：SetCellValue 与 SetCellFormula 的正确调用顺序，
// 以及重开文件后 GetCellValue 能否读到缓存值。
// 说明：excelize 模块的规范导入路径为 github.com/xuri/excelize/v2
// （qax-os 组织迁移至 xuri，go.mod 声明的 module 路径为 xuri）。
func TestSpikeFormulaCachedValue(t *testing.T) {
	f := excelize.NewFile()
	f.SetCellValue("Sheet1", "A1", 10)
	f.SetCellValue("Sheet1", "A2", 20)
	f.SetCellValue("Sheet1", "A3", 30) // 先写值作为缓存结果
	f.SetCellFormula("Sheet1", "A3", "=A1+A2")

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	g, err := excelize.OpenReader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	formula, err := g.GetCellFormula("Sheet1", "A3")
	if err != nil || formula != "=A1+A2" {
		t.Fatalf("formula = %q, err = %v", formula, err)
	}
	v, _ := g.GetCellValue("Sheet1", "A3")
	t.Logf("cached value readback = %q (空字符串说明回读不到缓存值)", v)
}

// V1 验证：条件格式（数据条 / Top-N）。
// v2.9.0 实际 API：SetConditionalFormat(sheet, rangeRef string, opts []excelize.ConditionalFormatOptions) error。
// 计划中的 []excelize.Format 形态在 v2.9.0 中不存在（无 Format 符号），
// 亦不需要 JSON 字符串形态（v1 时代 API）。data_bar 颜色字段为 BarColor；
// 无 "top10" 类型，对应类型为 "top"，Format 字段为 *int（NewConditionalStyle 返回）。
// 关键行为：同一 rangeRef 重复调用 SetConditionalFormat 会整体覆盖旧规则，
// 同范围多规则必须合并进一次调用的 opts 数组中（已由本测试断言共存）。
func TestSpikeConditionalFormat(t *testing.T) {
	f := excelize.NewFile()
	for i := 1; i <= 5; i++ {
		f.SetCellValue("Sheet1", fmt.Sprintf("A%d", i), i*10)
	}
	cfStyle, err := f.NewConditionalStyle(&excelize.Style{
		Font: &excelize.Font{Color: "9A0511"},
		Fill: excelize.Fill{Type: "pattern", Color: []string{"FEC7CE"}, Pattern: 1},
	})
	if err != nil {
		t.Fatalf("NewConditionalStyle 失败: %v", err)
	}
	err = f.SetConditionalFormat("Sheet1", "A1:A5", []excelize.ConditionalFormatOptions{
		{Type: "data_bar", Criteria: "=", MinType: "min", MaxType: "max", BarColor: "#638EC6"},
		{Type: "top", Criteria: "=", Value: "2", Format: &cfStyle},
	})
	if err != nil {
		t.Fatalf("条件格式写入失败（记录实际 API 到 FINDINGS.md）: %v", err)
	}
	cfs, err := f.GetConditionalFormats("Sheet1")
	if err != nil {
		t.Fatalf("回读条件格式失败: %v", err)
	}
	t.Logf("SetConditionalFormat(v2.9.0 实际签名): (sheet, rangeRef string, opts []excelize.ConditionalFormatOptions) error; 回读得到 %d 个范围", len(cfs))
	if got := len(cfs["A1:A5"]); got != 2 {
		t.Errorf("A1:A5 规则数 = %d, 期望 2（data_bar + top 应共存）", got)
	}
	for rng, rules := range cfs {
		for _, r := range rules {
			t.Logf("  范围=%s 规则 type=%q criteria=%q value=%q barColor=%q", rng, r.Type, r.Criteria, r.Value, r.BarColor)
		}
	}
}

// V3 验证：打印标题（每页重复表头行），通过 defined name _xlnm.Print_Titles。
// v2.9.0 文档要求打印标题同时指定 Scope 为对应工作表（否则默认 workbook scope）。
func TestSpikePrintTitles(t *testing.T) {
	f := excelize.NewFile()
	// 计划原形态：不指定 Scope（记录实际行为）
	err := f.SetDefinedName(&excelize.DefinedName{
		Name:     "_xlnm.Print_Titles",
		RefersTo: "Sheet1!$1:$1",
	})
	if err != nil {
		t.Fatalf("打印标题写入失败（记录实际 API 到 FINDINGS.md）: %v", err)
	}
	for _, dn := range f.GetDefinedName() {
		t.Logf("[计划形态-无Scope] Name=%q RefersTo=%q Scope=%q", dn.Name, dn.RefersTo, dn.Scope)
	}
	// v2.9.0 文档推荐形态：Scope 指向工作表
	err = f.SetDefinedName(&excelize.DefinedName{
		Name:     "_xlnm.Print_Titles",
		RefersTo: "Sheet1!$1:$1",
		Scope:    "Sheet1",
	})
	if err != nil {
		t.Fatalf("打印标题写入失败（带 Scope）: %v", err)
	}
	for _, dn := range f.GetDefinedName() {
		t.Logf("[带Scope] Name=%q RefersTo=%q Scope=%q", dn.Name, dn.RefersTo, dn.Scope)
	}
}

// V4 验证：1 万行写入耗时基线（渲染层性能预期）。
func TestSpikeWritePerf(t *testing.T) {
	f := excelize.NewFile()
	start := time.Now()
	for r := 1; r <= 10000; r++ {
		for c := 1; c <= 6; c++ {
			f.SetCellValue("Sheet1", fmt.Sprintf("%s%d", colName(c), r), r*c)
		}
	}
	writeCost := time.Since(start)
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	t.Logf("写入 10000 行 x 6 列耗时=%v, 写出字节数=%d", writeCost, buf.Len())
	if writeCost > 10*time.Second {
		t.Logf("WARN: 写入耗时超过 10 秒（%v），需记录到 FINDINGS.md", writeCost)
	}
}

// colName 将列序号（从 1 开始）转换为字母列名：1->A, 26->Z, 27->AA。
func colName(n int) string {
	var b []byte
	for n > 0 {
		n--
		b = append([]byte{byte('A' + n%26)}, b...)
		n /= 26
	}
	return string(b)
}
