package datahub

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"dynamic-report/internal/model"
)

func memDB(t *testing.T, ddl string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ddl); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestDBSourceOrdersBySortKey(t *testing.T) {
	db := memDB(t, `
CREATE TABLE sales (region TEXT, region_order INTEGER, city TEXT, amount REAL, qty INTEGER);
INSERT INTO sales VALUES ('华北',2,'北京',400,4);
INSERT INTO sales VALUES ('华东',1,'上海',100,1);
INSERT INTO sales VALUES ('华东',1,'杭州',300,3);
INSERT INTO sales VALUES ('华东',1,'上海',200,2);`)
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	src := NewDBSource("sales", db)
	rows, err := src.Rows(def)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %d", len(rows))
	}
	if rows[0].Keys[0] != "华东" || rows[3].Keys[0] != "华北" {
		t.Fatalf("first/last region = %v / %v", rows[0].Keys, rows[3].Keys)
	}
	// sort_key（region_order）驱动：华东(1)在前
	if rows[0].RowNo != 2 { // 华东上海 100 是表中第 2 行
		t.Fatalf("first RowNo = %d", rows[0].RowNo)
	}
}

func TestDBSourceRejectsBadFields(t *testing.T) {
	db := memDB(t, `CREATE TABLE sales (a TEXT, b REAL);`)
	def, err := model.Load("../model/testdata/valid.json")
	if err != nil {
		t.Fatal(err)
	}
	src := NewDBSource("sales", db)
	// 定义字段 region 不存在于表 → Rows 出错
	if _, err := src.Rows(def); err == nil {
		t.Fatal("expected error for missing column")
	}
}
