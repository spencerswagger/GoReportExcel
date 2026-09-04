package style

import (
	"fmt"
	"sort"
)

// ResolvedStyle is the merged style result for one cell. All fields are
// comparable so the struct can be used as a map key for interning.
type ResolvedStyle struct {
	BorderTop    string
	BorderRight  string
	BorderBottom string
	BorderLeft   string
	Fill         string
	FontColor    string
	Bold         bool
	RowHeight    float64
	Indent       int
}

// Engine applies style rules in priority order to cells.
type Engine struct {
	rules []Rule
}

// NewEngine builds an engine from a parsed rules document, copying the rules
// and sorting them by priority (stable ascending).
func NewEngine(doc *RulesDoc) *Engine {
	eng := &Engine{}
	if doc == nil {
		return eng
	}
	eng.rules = append(eng.rules, doc.Rules...)
	sort.SliceStable(eng.rules, func(i, j int) bool {
		return eng.rules[i].Priority < eng.rules[j].Priority
	})
	return eng
}

// Resolve evaluates all rules against ctx, merging the styles of matched
// rules in priority order. It returns the merged style and the ids of the
// matched rules. Eval errors are wrapped with the offending rule id.
func (e *Engine) Resolve(ctx CellContext) (ResolvedStyle, []string, error) {
	var rs ResolvedStyle
	var hits []string
	for _, r := range e.rules {
		ok, err := r.When.Eval(ctx)
		if err != nil {
			return rs, hits, fmt.Errorf("rule %q: %w", r.ID, err)
		}
		if !ok {
			continue
		}
		hits = append(hits, r.ID)
		applySpec(&rs, r.Style, ctx)
	}
	return rs, hits, nil
}

// applySpec merges a single rule's style spec into the accumulated result.
func applySpec(rs *ResolvedStyle, s StyleSpec, ctx CellContext) {
	if s.Border != nil {
		if s.Border.Top != nil {
			rs.BorderTop = s.Border.Top.Resolve(ctx)
		}
		if s.Border.Right != nil {
			rs.BorderRight = s.Border.Right.Resolve(ctx)
		}
		if s.Border.Bottom != nil {
			rs.BorderBottom = s.Border.Bottom.Resolve(ctx)
		}
		if s.Border.Left != nil {
			rs.BorderLeft = s.Border.Left.Resolve(ctx)
		}
	}
	if s.Fill != nil {
		rs.Fill = s.Fill.Color
	}
	if s.FontColor != "" {
		rs.FontColor = s.FontColor
	}
	if s.Bold {
		rs.Bold = true
	}
	if s.RowHeight > 0 {
		rs.RowHeight = s.RowHeight
	}
	if s.Indent != nil {
		if s.Indent.Expr == "dim_depth" && ctx.DimDepth >= 0 {
			rs.Indent = ctx.DimDepth
		} else {
			rs.Indent = s.Indent.Value
		}
	}
}
