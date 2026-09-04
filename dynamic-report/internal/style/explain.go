package style

import (
	"fmt"
	"strings"
)

// RuleExplain 描述一条命中规则及其命中原因（自然语言），供预览样式解释面板使用。
type RuleExplain struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// ResolveTraced 与 Resolve 相同，但返回每条命中规则的解释。
// 仅预览模式使用；导出路径调用 Resolve（零额外开销）。
func (e *Engine) ResolveTraced(ctx *CellContext) (ResolvedStyle, []RuleExplain, error) {
	var out ResolvedStyle
	var explains []RuleExplain
	for _, r := range e.rules {
		ok, err := r.When.Eval(*ctx)
		if err != nil {
			return out, nil, fmt.Errorf("rule %q: %w", r.ID, err)
		}
		if !ok {
			continue
		}
		applySpec(&out, r.Style, *ctx)
		explains = append(explains, RuleExplain{ID: r.ID, Reason: r.When.Explain()})
	}
	return out, explains, nil
}

// Explain 生成条件的自然语言描述（仅支持计划 DSL 的谓词与组合器）。
func (c *Cond) Explain() string {
	switch {
	case len(c.All) > 0:
		return "all(" + explainSeq(c.All) + ")"
	case len(c.Any) > 0:
		return "any(" + explainSeq(c.Any) + ")"
	case c.Not != nil:
		return "not(" + c.Not.Explain() + ")"
	default:
		return explainLeaf(c)
	}
}

func explainSeq(cs []Cond) string {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i] = c.Explain()
	}
	return strings.Join(parts, ", ")
}

func explainLeaf(c *Cond) string {
	base := c.Ctx
	if c.Mod > 0 {
		base = fmt.Sprintf("%s %% %d", base, c.Mod)
	}
	switch c.Op {
	case "in":
		vals := make([]string, len(c.Values))
		for i, v := range c.Values {
			vals[i] = formatValue(v)
		}
		return fmt.Sprintf("%s in [%s]", base, strings.Join(vals, ", "))
	case "between":
		if len(c.Values) >= 2 {
			return fmt.Sprintf("%s between %s and %s", base, formatValue(c.Values[0]), formatValue(c.Values[1]))
		}
		return base + " between"
	case "odd", "even":
		return base + " " + c.Op
	case "prefix":
		vals := make([]string, len(c.Values))
		for i, v := range c.Values {
			vals[i] = formatValue(v)
		}
		return fmt.Sprintf("%s prefix %s", base, strings.Join(vals, "."))
	default:
		return fmt.Sprintf("%s %s %s", base, c.Op, formatValue(c.Value))
	}
}

// formatValue 渲染 DSL 值用于自然语言输出，字符串加引号以保证解释无歧义。
func formatValue(v any) string {
	if s, ok := v.(string); ok {
		return fmt.Sprintf("%q", s)
	}
	return fmt.Sprint(v)
}
