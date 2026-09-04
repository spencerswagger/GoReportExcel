package pipeline

import (
	"fmt"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/engine"
	"dynamic-report/internal/model"
	"dynamic-report/internal/schema"
	"dynamic-report/internal/style"
)

// BuildReport 把数据源与报告定义组装为完整渲染 schema（非 trace 模式）。
func BuildReport(def *model.ReportDefinition, src datahub.Source) (*schema.RenderSchema, error) {
	return build(def, src, false)
}

// BuildReportWithTrace 与 BuildReport 相同，但开启 trace 输出规则命中列表
// （预览模式使用）。
func BuildReportWithTrace(def *model.ReportDefinition, src datahub.Source) (*schema.RenderSchema, error) {
	return build(def, src, true)
}

// build 执行完整流水线：取数 → RowCap 检查 → 分组物化（GroupStack）
// → 位置遍 → 装配遍 → 样式引擎 → RenderSchema 构建。
func build(def *model.ReportDefinition, src datahub.Source, trace bool) (*schema.RenderSchema, error) {
	rows, err := src.Rows(def)
	if err != nil {
		return nil, err
	}
	if def.Dataset.RowCap > 0 && len(rows) > def.Dataset.RowCap {
		return nil, fmt.Errorf("row cap exceeded: %d > %d", len(rows), def.Dataset.RowCap)
	}

	gs := engine.NewGroupStack(def)
	for _, r := range rows {
		gs.Feed(r)
	}
	gs.Finish()
	engine.PositionPass(def, gs.Layout)
	engine.AssemblyPass(def, gs.Layout)

	doc, err := style.ParseRules(def.StyleRules)
	if err != nil {
		return nil, err
	}
	ovRules, err := CompileOverrides(def)
	if err != nil {
		return nil, err
	}
	allRules := append(doc.Rules, ovRules...)
	return schema.Build(def, gs.Layout, style.NewEngine(&style.RulesDoc{Rules: allRules}), trace)
}
