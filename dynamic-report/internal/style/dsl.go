package style

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// RulesDoc is the parsed style-rules document.
type RulesDoc struct {
	Version int    `json:"version"`
	Rules   []Rule `json:"rules"`
}

// Rule is a single conditional style rule.
type Rule struct {
	ID       string    `json:"id"`
	Priority int       `json:"priority"`
	When     Cond      `json:"when"`
	Style    StyleSpec `json:"style"`
}

// Cond is a recursive condition tree. Exactly one of the combinators
// (All/Any/Not) may be set; otherwise the node is a leaf predicate on Ctx.
type Cond struct {
	All    []Cond `json:"all,omitempty"`
	Any    []Cond `json:"any,omitempty"`
	Not    *Cond  `json:"not,omitempty"`
	Ctx    string `json:"ctx,omitempty"`
	Op     string `json:"op,omitempty"`
	Value  any    `json:"value,omitempty"`
	Values []any  `json:"values,omitempty"`
	Mod    int    `json:"mod,omitempty"`
}

// BorderSide describes one border of a cell. At controls when the Style is
// applied; Else is used when the at condition does not hold.
type BorderSide struct {
	At    string `json:"at,omitempty"`
	Style string `json:"style"`
	Else  string `json:"else,omitempty"`
}

// BorderSpec holds per-side border styling.
type BorderSpec struct {
	Top    *BorderSide `json:"top,omitempty"`
	Bottom *BorderSide `json:"bottom,omitempty"`
	Left   *BorderSide `json:"left,omitempty"`
	Right  *BorderSide `json:"right,omitempty"`
}

// FillSpec is a solid cell fill.
type FillSpec struct {
	Color string `json:"color"`
}

// IndentSpec sets cell indentation from a dimension depth expression or a
// literal value.
type IndentSpec struct {
	Expr  string `json:"expr,omitempty"`
	Value int    `json:"value,omitempty"`
}

// StyleSpec is the style applied when a rule matches.
type StyleSpec struct {
	Border    *BorderSpec `json:"border,omitempty"`
	Fill      *FillSpec   `json:"fill,omitempty"`
	FontColor string      `json:"font_color,omitempty"`
	Bold      bool        `json:"bold,omitempty"`
	RowHeight float64     `json:"row_height,omitempty"`
	Indent    *IndentSpec `json:"indent,omitempty"`
}

var validLineStyle = map[string]bool{
	"hair": true, "thin": true, "medium": true, "thick": true, "double": true, "dashed": true,
}

var validAt = map[string]bool{
	"": true, "always": true,
	"group_first_row": true, "group_last_row": true,
	"group_first_col": true, "group_last_col": true,
	"sheet_first_row": true, "sheet_last_row": true,
}

var validCondOp = map[string]bool{
	"eq": true, "ne": true, "in": true, "gt": true, "gte": true,
	"lt": true, "lte": true, "between": true, "prefix": true,
	"odd": true, "even": true,
}

var validCtx = map[string]bool{
	"row_type": true, "col_role": true, "dim_depth": true, "seq_in_group": true,
	"group_path": true, "value": true, "metric_key": true, "dim_key": true,
	"is_group_first_row": true, "is_group_last_row": true,
	"is_group_first_col": true, "is_group_last_col": true,
	"is_sheet_first_row": true, "is_sheet_last_row": true,
}

// ParseRules parses and validates a raw style-rules document. An empty input
// yields a document with no rules. Rules are returned sorted by priority
// (stable ascending).
func ParseRules(raw json.RawMessage) (*RulesDoc, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return &RulesDoc{}, nil
	}
	var doc RulesDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse style rules: %w", err)
	}
	if err := doc.Validate(); err != nil {
		return nil, err
	}
	sort.SliceStable(doc.Rules, func(i, j int) bool {
		return doc.Rules[i].Priority < doc.Rules[j].Priority
	})
	return &doc, nil
}

// Validate checks rule ids, conditions and styles.
func (d *RulesDoc) Validate() error {
	seen := make(map[string]bool, len(d.Rules))
	for i := range d.Rules {
		r := &d.Rules[i]
		if r.ID == "" {
			return fmt.Errorf("rule %d: id is required", i)
		}
		if seen[r.ID] {
			return fmt.Errorf("rule %q: duplicate id", r.ID)
		}
		seen[r.ID] = true
		if err := r.When.validate(); err != nil {
			return fmt.Errorf("rule %q: when: %w", r.ID, err)
		}
		if err := r.Style.validate(); err != nil {
			return fmt.Errorf("rule %q: style: %w", r.ID, err)
		}
	}
	return nil
}

func (c *Cond) validate() error {
	combinators := 0
	if len(c.All) > 0 {
		combinators++
	}
	if len(c.Any) > 0 {
		combinators++
	}
	if c.Not != nil {
		combinators++
	}
	if combinators > 1 {
		return fmt.Errorf("all/any/not are mutually exclusive")
	}
	if combinators == 1 {
		for i := range c.All {
			if err := c.All[i].validate(); err != nil {
				return err
			}
		}
		for i := range c.Any {
			if err := c.Any[i].validate(); err != nil {
				return err
			}
		}
		if c.Not != nil {
			return c.Not.validate()
		}
		return nil
	}
	if !validCtx[c.Ctx] {
		return fmt.Errorf("ctx %q is not a valid context", c.Ctx)
	}
	if !validCondOp[c.Op] {
		return fmt.Errorf("op %q is not a valid operator", c.Op)
	}
	return nil
}

func (s *StyleSpec) validate() error {
	if s.Border != nil {
		sides := []*BorderSide{s.Border.Top, s.Border.Bottom, s.Border.Left, s.Border.Right}
		for _, side := range sides {
			if side == nil {
				continue
			}
			if !validLineStyle[side.Style] {
				return fmt.Errorf("border style %q is not a valid line style", side.Style)
			}
			if side.Else != "" && !validLineStyle[side.Else] {
				return fmt.Errorf("border else style %q is not a valid line style", side.Else)
			}
			if !validAt[side.At] {
				return fmt.Errorf("border at %q is not a valid position", side.At)
			}
		}
	}
	if s.Indent != nil && s.Indent.Expr != "" && s.Indent.Expr != "dim_depth" {
		return fmt.Errorf("indent expr %q must be \"\" or \"dim_depth\"", s.Indent.Expr)
	}
	return nil
}
