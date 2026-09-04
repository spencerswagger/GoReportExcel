// Command reportgen 从报告定义与数据源构建 .xlsx 报表。
//
// 用法：
//
//	reportgen -def report.json -data sales.csv [-o report.xlsx] [-schema-out schema.json]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"dynamic-report/internal/datahub"
	"dynamic-report/internal/model"
	"dynamic-report/internal/pipeline"
	"dynamic-report/internal/render"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "reportgen:", err)
		os.Exit(1)
	}
}

func run() error {
	defPath := flag.String("def", "", "path to the report definition JSON")
	dataPath := flag.String("data", "", "path to the source data (CSV)")
	outPath := flag.String("o", "report.xlsx", "output xlsx path")
	schemaOut := flag.String("schema-out", "", "optional path to write the RenderSchema JSON")
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), `reportgen builds an xlsx report from a definition and a data source.

Usage:
  reportgen -def <def.json> -data <data.csv> [-o report.xlsx] [-schema-out schema.json]

Flags:
`)
		flag.PrintDefaults()
	}
	flag.Parse()

	if *defPath == "" || *dataPath == "" {
		flag.Usage()
		return fmt.Errorf("-def and -data are required")
	}

	def, err := model.Load(*defPath)
	if err != nil {
		return err
	}
	s, err := pipeline.BuildReport(def, datahub.NewCSVSource(*dataPath))
	if err != nil {
		return err
	}

	if *schemaOut != "" {
		b, err := json.MarshalIndent(s, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal schema: %w", err)
		}
		if err := os.WriteFile(*schemaOut, b, 0o644); err != nil {
			return fmt.Errorf("write schema: %w", err)
		}
	}

	out, err := os.Create(*outPath)
	if err != nil {
		return fmt.Errorf("create %s: %w", *outPath, err)
	}
	defer out.Close()
	if err := render.Render(def, s, out); err != nil {
		return fmt.Errorf("render %s: %w", *outPath, err)
	}

	fmt.Printf("written: %s (%d rows)\n", *outPath, s.Report.RowTotal)
	return nil
}
