package engine

import (
	"math"
	"strconv"

	"dynamic-report/internal/model"
)

// Aggregator incrementally computes one aggregation function over fed values.
type Aggregator struct {
	fn    model.AggFunc
	sum   float64
	count int64
	min   float64
	max   float64
	empty bool
}

// NewAggregator creates an empty aggregator for the given function.
func NewAggregator(fn model.AggFunc) *Aggregator {
	return &Aggregator{
		fn:    fn,
		min:   math.Inf(1),
		max:   math.Inf(-1),
		empty: true,
	}
}

// Update folds a single value into the aggregator. nil values are skipped.
// For AggCount every non-nil value counts regardless of parseability; for the
// other functions values failing to parse as float are skipped.
func (a *Aggregator) Update(v any) {
	if v == nil {
		return
	}
	if a.fn == model.AggCount {
		a.count++
		return
	}
	f, ok := toFloat(v)
	if !ok {
		return
	}
	a.sum += f
	a.count++
	if f < a.min {
		a.min = f
	}
	if f > a.max {
		a.max = f
	}
	a.empty = false
}

// Value returns the aggregated result.
func (a *Aggregator) Value() any {
	switch a.fn {
	case model.AggSum:
		if a.empty {
			return 0.0
		}
		return a.sum
	case model.AggCount:
		return float64(a.count)
	case model.AggAvg:
		if a.count == 0 {
			return 0.0
		}
		return a.sum / float64(a.count)
	case model.AggMax:
		if a.empty {
			return nil
		}
		return a.max
	case model.AggMin:
		if a.empty {
			return nil
		}
		return a.min
	default:
		return nil
	}
}

// toFloat converts common numeric representations to float64.
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	case string:
		f, err := strconv.ParseFloat(x, 64)
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}
