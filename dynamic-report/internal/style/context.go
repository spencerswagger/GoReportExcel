package style

import (
	"encoding/json"
	"fmt"
	"math"
)

// RowType identifies the kind of report row.
type RowType uint8

const (
	RowHeader RowType = iota
	RowDetail
	RowSubtotal
	RowTotal
)

// String returns the DSL name of the row type.
func (r RowType) String() string {
	switch r {
	case RowHeader:
		return "header"
	case RowDetail:
		return "detail"
	case RowSubtotal:
		return "subtotal"
	case RowTotal:
		return "total"
	default:
		return "unknown"
	}
}

// ColRole identifies whether a column holds a dimension or a metric.
type ColRole uint8

const (
	ColDimension ColRole = iota
	ColMetric
)

// String returns the DSL name of the column role.
func (r ColRole) String() string {
	switch r {
	case ColDimension:
		return "dimension"
	case ColMetric:
		return "metric"
	default:
		return "unknown"
	}
}

// CellContext carries the state a style rule condition is evaluated against.
type CellContext struct {
	Row           int
	Col           int
	RowType       RowType
	ColRole       ColRole
	DimDepth      int
	GroupPath     []string
	SeqInGroup    int
	MetricKey     string
	DimKey        string
	GroupFirstRow bool
	GroupLastRow  bool
	GroupFirstCol bool
	GroupLastCol  bool
	SheetFirstRow bool
	SheetLastRow  bool
	Value         any
}

// Eval evaluates the condition tree against the context.
func (c *Cond) Eval(ctx CellContext) (bool, error) {
	switch {
	case len(c.All) > 0:
		for i := range c.All {
			ok, err := c.All[i].Eval(ctx)
			if err != nil {
				return false, err
			}
			if !ok {
				return false, nil // short-circuit
			}
		}
		return true, nil
	case len(c.Any) > 0:
		for i := range c.Any {
			ok, err := c.Any[i].Eval(ctx)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil // short-circuit
			}
		}
		return false, nil
	case c.Not != nil:
		ok, err := c.Not.Eval(ctx)
		if err != nil {
			return false, err
		}
		return !ok, nil
	default:
		return c.evalLeaf(ctx)
	}
}

func (c *Cond) evalLeaf(ctx CellContext) (bool, error) {
	switch c.Ctx {
	case "row_type":
		return matchStrings(ctx.RowType.String(), c.Op, c.Value, c.Values)
	case "col_role":
		return matchStrings(ctx.ColRole.String(), c.Op, c.Value, c.Values)
	case "dim_depth":
		return matchNumber(float64(ctx.DimDepth), c)
	case "seq_in_group":
		return matchNumber(float64(ctx.SeqInGroup), c)
	case "group_path":
		return matchGroupPath(ctx.GroupPath, c)
	case "value":
		f, ok := asNumber(ctx.Value)
		if !ok {
			return false, nil
		}
		return matchNumber(f, c)
	case "metric_key":
		return matchStrings(ctx.MetricKey, c.Op, c.Value, c.Values)
	case "dim_key":
		return matchStrings(ctx.DimKey, c.Op, c.Value, c.Values)
	case "is_group_first_row":
		return boolEq(ctx.GroupFirstRow, c)
	case "is_group_last_row":
		return boolEq(ctx.GroupLastRow, c)
	case "is_group_first_col":
		return boolEq(ctx.GroupFirstCol, c)
	case "is_group_last_col":
		return boolEq(ctx.GroupLastCol, c)
	case "is_sheet_first_row":
		return boolEq(ctx.SheetFirstRow, c)
	case "is_sheet_last_row":
		return boolEq(ctx.SheetLastRow, c)
	default:
		return false, fmt.Errorf("unsupported ctx %q", c.Ctx)
	}
}

func matchStrings(s, op string, value any, values []any) (bool, error) {
	switch op {
	case "eq":
		v, ok := asString(value)
		if !ok {
			return false, nil
		}
		return s == v, nil
	case "ne":
		v, ok := asString(value)
		if !ok {
			return false, nil
		}
		return s != v, nil
	case "in":
		for _, item := range values {
			v, ok := asString(item)
			if ok && s == v {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, fmt.Errorf("string op %q not supported", op)
	}
}

func matchGroupPath(path []string, c *Cond) (bool, error) {
	if c.Op != "prefix" {
		return false, fmt.Errorf("group_path only supports op prefix, got %q", c.Op)
	}
	prefix := make([]string, 0, len(c.Values))
	for _, v := range c.Values {
		s, ok := asString(v)
		if !ok {
			return false, nil
		}
		prefix = append(prefix, s)
	}
	if len(prefix) > len(path) {
		return false, nil
	}
	for i := range prefix {
		if path[i] != prefix[i] {
			return false, nil
		}
	}
	return true, nil
}

func matchNumber(n float64, c *Cond) (bool, error) {
	if c.Mod > 0 {
		n = math.Mod(n, float64(c.Mod))
	}
	switch c.Op {
	case "odd":
		return math.Mod(math.Abs(n), 2) == 1, nil
	case "even":
		return math.Mod(math.Abs(n), 2) == 0, nil
	case "eq", "ne", "gt", "gte", "lt", "lte":
		v, ok := asNumber(c.Value)
		if !ok {
			return false, nil
		}
		switch c.Op {
		case "eq":
			return n == v, nil
		case "ne":
			return n != v, nil
		case "gt":
			return n > v, nil
		case "gte":
			return n >= v, nil
		case "lt":
			return n < v, nil
		case "lte":
			return n <= v, nil
		}
	case "between":
		if len(c.Values) != 2 {
			return false, fmt.Errorf("between requires exactly 2 values, got %d", len(c.Values))
		}
		lo, ok1 := asNumber(c.Values[0])
		hi, ok2 := asNumber(c.Values[1])
		if !ok1 || !ok2 {
			return false, nil
		}
		return n >= lo && n <= hi, nil
	default:
		return false, fmt.Errorf("number op %q not supported", c.Op)
	}
	return false, nil
}

func asNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func asString(v any) (string, bool) {
	switch s := v.(type) {
	case string:
		return s, true
	case json.Number:
		return s.String(), true
	default:
		return "", false
	}
}

func boolEq(flag bool, c *Cond) (bool, error) {
	v, ok := asBool(c.Value)
	if !ok {
		return false, nil
	}
	switch c.Op {
	case "eq":
		return flag == v, nil
	case "ne":
		return flag != v, nil
	default:
		return false, fmt.Errorf("bool op %q not supported", c.Op)
	}
}

func asBool(v any) (bool, bool) {
	switch b := v.(type) {
	case bool:
		return b, true
	case string:
		switch b {
		case "true":
			return true, true
		case "false":
			return false, true
		}
	}
	return false, false
}

// Resolve returns the line style for this border side: Style when At is
// empty/"always" or the at flag holds, Else otherwise.
func (b *BorderSide) Resolve(ctx CellContext) string {
	if b.At == "" || b.At == "always" {
		return b.Style
	}
	if b.atFlag(ctx) {
		return b.Style
	}
	return b.Else
}

func (b *BorderSide) atFlag(ctx CellContext) bool {
	switch b.At {
	case "group_first_row":
		return ctx.GroupFirstRow
	case "group_last_row":
		return ctx.GroupLastRow
	case "group_first_col":
		return ctx.GroupFirstCol
	case "group_last_col":
		return ctx.GroupLastCol
	case "sheet_first_row":
		return ctx.SheetFirstRow
	case "sheet_last_row":
		return ctx.SheetLastRow
	default:
		return false
	}
}
