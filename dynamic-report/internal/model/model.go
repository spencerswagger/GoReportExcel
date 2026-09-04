package model

import (
	"encoding/json"
	"fmt"
	"os"
)

// AggFunc is the aggregation function applied to a metric.
type AggFunc string

const (
	AggSum   AggFunc = "SUM"
	AggAvg   AggFunc = "AVG"
	AggCount AggFunc = "COUNT"
	AggMax   AggFunc = "MAX"
	AggMin   AggFunc = "MIN"
)

// FieldDef describes a field of the source dataset.
type FieldDef struct {
	Key     string `json:"key"`
	Type    string `json:"type"`
	SortKey string `json:"sort_key,omitempty"`
}

// SortSpec describes how a dimension's values are ordered.
type SortSpec struct {
	By  string `json:"by"`
	Dir string `json:"dir"`
}

// DimensionDef is a grouping dimension of the report.
type DimensionDef struct {
	Field string   `json:"field"`
	Label string   `json:"label"`
	Sort  SortSpec `json:"sort"`
}

// MetricDef is an aggregated measure of the report.
type MetricDef struct {
	Field     string  `json:"field"`
	Label     string  `json:"label"`
	Agg       AggFunc `json:"agg"`
	NumFmtRef string  `json:"num_fmt_ref,omitempty"`
}

// Dataset describes the source dataset the report is built on.
type Dataset struct {
	SourceRef string     `json:"source_ref"`
	Fields    []FieldDef `json:"fields"`
	RowCap    int        `json:"row_cap,omitempty"`
}

// LayoutOpts carries layout-level report options.
type LayoutOpts struct {
	TotalPosition string `json:"total_position,omitempty"`
}

// FontSpec describes a font used by the report styles.
type FontSpec struct {
	Name string `json:"name"`
	Size int    `json:"size"`
	Bold bool   `json:"bold"`
}

// BaseStyles holds the default styling of the rendered report.
type BaseStyles struct {
	HeaderFont FontSpec          `json:"header_font"`
	BodyFont   FontSpec          `json:"body_font"`
	NumFormats map[string]string `json:"num_formats"`
}

// ReportDefinition is the full declarative description of a report.
type ReportDefinition struct {
	ID         string          `json:"id"`
	Version    int             `json:"version"`
	Name       string          `json:"name"`
	Dataset    Dataset         `json:"dataset"`
	Dimensions []DimensionDef  `json:"dimensions"`
	Metrics    []MetricDef     `json:"metrics"`
	LayoutOpts LayoutOpts      `json:"layout_opts"`
	BaseStyles BaseStyles      `json:"base_styles"`
	StyleRules json.RawMessage `json:"style_rules"`
}

// Load reads a report definition from path, parses it and validates it.
func Load(path string) (*ReportDefinition, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var def ReportDefinition
	if err := json.Unmarshal(b, &def); err != nil {
		return nil, fmt.Errorf("parse definition %s: %w", path, err)
	}
	if err := def.Validate(); err != nil {
		return nil, err
	}
	return &def, nil
}

// Validate checks the definition for consistency and applies defaults.
func (d *ReportDefinition) Validate() error {
	if len(d.Metrics) < 1 {
		return fmt.Errorf("metrics: at least one metric is required")
	}

	fields := make(map[string]string, len(d.Dataset.Fields))
	for _, f := range d.Dataset.Fields {
		fields[f.Key] = f.Type
	}

	for _, dim := range d.Dimensions {
		ft, ok := fields[dim.Field]
		if !ok {
			return fmt.Errorf("dimension %q: field %q not found in dataset", dim.Field, dim.Field)
		}
		if ft != "string" {
			return fmt.Errorf("dimension %q: field %q type %q must be \"string\"", dim.Field, dim.Field, ft)
		}
		if dim.Sort.By != "sort_key" && dim.Sort.By != "value" {
			return fmt.Errorf("dimension %q: sort.by %q must be \"sort_key\" or \"value\"", dim.Field, dim.Sort.By)
		}
		if dim.Sort.Dir != "asc" && dim.Sort.Dir != "desc" {
			return fmt.Errorf("dimension %q: sort.dir %q must be \"asc\" or \"desc\"", dim.Field, dim.Sort.Dir)
		}
	}

	for _, m := range d.Metrics {
		if _, ok := fields[m.Field]; !ok {
			return fmt.Errorf("metric %q: field %q not found in dataset", m.Field, m.Field)
		}
		switch m.Agg {
		case AggSum, AggAvg, AggCount, AggMax, AggMin:
		default:
			return fmt.Errorf("metric %q: unsupported agg %q", m.Field, m.Agg)
		}
	}

	if d.LayoutOpts.TotalPosition == "" {
		d.LayoutOpts.TotalPosition = "bottom"
	}
	if d.LayoutOpts.TotalPosition != "bottom" && d.LayoutOpts.TotalPosition != "top" {
		return fmt.Errorf("layout_opts.total_position %q must be \"bottom\", \"top\" or empty", d.LayoutOpts.TotalPosition)
	}

	return nil
}
