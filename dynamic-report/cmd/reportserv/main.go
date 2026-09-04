package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/catalog"
	"dynamic-report/internal/datahub"
	"dynamic-report/internal/httpapi"
	"dynamic-report/internal/orchestrator"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "catalog.db", "sqlite path")
	artDir := flag.String("artifacts", "artifacts", "artifact directory")
	csvDir := flag.String("csv", ".", "csv data directory")
	sourceRef := flag.String("source", "csv_local", "source ref for CSV fallback")
	flag.Parse()

	if err := os.MkdirAll(*artDir, 0o755); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	store, err := catalog.NewStore(db)
	if err != nil {
		log.Fatal(err)
	}
	cache := catalog.NewCache(store)
	orc := orchestrator.NewOrchestrator(nil)
	orc.SetArtifactDir(*artDir)

	// 数据源工厂：csv_local 读取 <csvDir>/<table>.csv；其余返回错误
	dsf := func(ref string) (datahub.Source, error) {
		if ref != *sourceRef {
			return nil, fmt.Errorf("unknown source ref %q (only %q supported)", ref, *sourceRef)
		}
		return datahub.NewCSVSource(filepath.Join(*csvDir, "data.csv")), nil
	}
	srv := httpapi.NewServer(cache, orc, dsf)

	log.Printf("reportserv listening on %s (db=%s artifacts=%s csv=%s)", *addr, *dbPath, *artDir, *csvDir)
	if err := http.ListenAndServe(*addr, srv); err != nil {
		log.Fatal(err)
	}
}
