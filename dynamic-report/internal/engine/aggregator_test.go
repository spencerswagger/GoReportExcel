package engine

import (
	"math"
	"testing"

	"dynamic-report/internal/model"
)

func feed(a *Aggregator, vs ...any) {
	for _, v := range vs {
		a.Update(v)
	}
}

func TestAggSum(t *testing.T) {
	a := NewAggregator(model.AggSum)
	feed(a, 1.5, 2.5, "3")
	got, ok := a.Value().(float64)
	if !ok {
		t.Fatalf("Value() = %T (%v), want float64", a.Value(), a.Value())
	}
	if math.Abs(got-7) >= 1e-9 {
		t.Fatalf("SUM = %v, want 7 (|diff| < 1e-9)", got)
	}
}

func TestAggSumEmpty(t *testing.T) {
	a := NewAggregator(model.AggSum)
	got, ok := a.Value().(float64)
	if !ok {
		t.Fatalf("empty SUM Value() = %T (%v), want float64 0.0", a.Value(), a.Value())
	}
	if got != 0.0 {
		t.Fatalf("empty SUM = %v, want 0.0", got)
	}
}

func TestAggAvg(t *testing.T) {
	a := NewAggregator(model.AggAvg)
	feed(a, 10, 20, 30)
	got, ok := a.Value().(float64)
	if !ok {
		t.Fatalf("Value() = %T (%v), want float64", a.Value(), a.Value())
	}
	if got != 20 {
		t.Fatalf("AVG = %v, want 20", got)
	}
}

func TestAggCount(t *testing.T) {
	a := NewAggregator(model.AggCount)
	feed(a, 1, "x", nil, 3)
	got, ok := a.Value().(float64)
	if !ok {
		t.Fatalf("Value() = %T (%v), want float64", a.Value(), a.Value())
	}
	if got != 3 {
		t.Fatalf("COUNT = %v, want 3", got)
	}
}

func TestAggMinMax(t *testing.T) {
	mx := NewAggregator(model.AggMax)
	feed(mx, 5, 9, 3)
	if got := mx.Value().(float64); got != 9 {
		t.Fatalf("MAX = %v, want 9", got)
	}
	mn := NewAggregator(model.AggMin)
	feed(mn, 5, 9, 3)
	if got := mn.Value().(float64); got != 3 {
		t.Fatalf("MIN = %v, want 3", got)
	}
	empty := NewAggregator(model.AggMax)
	if v := empty.Value(); v != nil {
		t.Fatalf("empty MAX Value() = %v, want nil", v)
	}
}
