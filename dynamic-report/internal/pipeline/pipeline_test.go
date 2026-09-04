package pipeline

import (
	"strings"
	"testing"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
)

// loadDef 加载 e2e 报告定义。
func loadDef(t *testing.T) *model.ReportDefinition {
	t.Helper()
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	return def
}

// TestBuildReportE2E 端到端：定义 + CSV → 完整 schema，核对行数与末行类型。
func TestBuildReportE2E(t *testing.T) {
	s, err := BuildReport(loadDef(t), datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Rows) != 11 {
		t.Fatalf("rows = %d, want 11 (1 header + 4 detail + 5 subtotal + 1 total)", len(s.Rows))
	}
	last := s.Rows[len(s.Rows)-1]
	if last.Type != "total" || last.Idx != 11 {
		t.Fatalf("last row = idx %d type %q, want idx 11 type total", last.Idx, last.Type)
	}
}

// TestBuildReportRowCapRejects 超过 RowCap 的行数必须被拒绝。
func TestBuildReportRowCapRejects(t *testing.T) {
	def := loadDef(t)
	def.Dataset.RowCap = 2 // 数据源 4 行 > 2

	_, err := BuildReport(def, datahub.NewCSVSource("../datahub/testdata/sales.csv"))
	if err == nil {
		t.Fatal("expected error for row cap exceeded, got nil")
	}
	if !strings.Contains(err.Error(), "row cap") {
		t.Fatalf("error = %q, want to contain \"row cap\"", err.Error())
	}
}
