package pipeline

import (
	"encoding/json"
	"fmt"

	"dynamic-report/internal/model"
	"dynamic-report/internal/style"
)

// overridePriority 高于任何 DSL 规则（设计文档：override > 规则 > 模板）。
const overridePriority = 10000

// CompileOverrides 把语义锚定 override 编译为最高优先级伪规则。
// scope → when（all 组合：group_path prefix、row_type eq、col_role/metric 限定），
// style_patch → style.StyleSpec（JSON 往返转换，保持 model 不依赖 style）。
func CompileOverrides(def *model.ReportDefinition) ([]style.Rule, error) {
	var out []style.Rule
	for _, ov := range def.Overrides {
		conds := make([]style.Cond, 0, 4)
		if len(ov.Scope.GroupPathPrefix) > 0 {
			vals := make([]any, len(ov.Scope.GroupPathPrefix))
			for i, s := range ov.Scope.GroupPathPrefix {
				vals[i] = s
			}
			conds = append(conds, style.Cond{Ctx: "group_path", Op: "prefix", Values: vals})
		}
		if ov.Scope.RowType != "" {
			conds = append(conds, style.Cond{Ctx: "row_type", Op: "eq", Value: ov.Scope.RowType})
		}
		if ov.Scope.Metric != "" {
			conds = append(conds,
				style.Cond{Ctx: "col_role", Op: "eq", Value: "metric"},
				style.Cond{Ctx: "metric_key", Op: "eq", Value: ov.Scope.Metric},
			)
		}
		if ov.Scope.Dim != "" {
			conds = append(conds,
				style.Cond{Ctx: "col_role", Op: "eq", Value: "dimension"},
				style.Cond{Ctx: "dim_key", Op: "eq", Value: ov.Scope.Dim},
			)
		}
		spec, err := stylePatchToSpec(ov.StylePatch)
		if err != nil {
			return nil, fmt.Errorf("override %q: %w", ov.ID, err)
		}
		out = append(out, style.Rule{
			ID:       "override:" + ov.ID,
			Priority: overridePriority,
			When:     style.Cond{All: conds},
			Style:    spec,
		})
	}
	return out, nil
}

// stylePatchToSpec 通过 JSON 往返把镜像结构转换为 style.StyleSpec。
func stylePatchToSpec(patch model.StylePatchJSON) (style.StyleSpec, error) {
	b, err := json.Marshal(patch)
	if err != nil {
		return style.StyleSpec{}, err
	}
	var spec style.StyleSpec
	if err := json.Unmarshal(b, &spec); err != nil {
		return style.StyleSpec{}, err
	}
	// 复用以规则为中心的线型/at 校验（发布期已验证，此处防御）。
	// RulesDoc.Validate 要求非空 id 与合法 when，这里用占位值仅用于触发样式校验。
	doc := &style.RulesDoc{Rules: []style.Rule{{
		ID:    "override:validation",
		When:  style.Cond{Ctx: "row_type", Op: "eq", Value: "detail"},
		Style: spec,
	}}}
	if err := doc.Validate(); err != nil {
		return style.StyleSpec{}, err
	}
	return spec, nil
}
