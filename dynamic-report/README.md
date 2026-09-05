# dynamic-report

动态报表生成服务：Go 单二进制后端（`reportserv`）提供报表定义的草稿 / 发布 / 版本管理 API，`reportgen` 负责渲染导出（Excel 等）。前端 SPA 见仓库根目录 `web/`。

## 构建

需要 Go 1.27.1+。依赖通过模块代理下载（国内网络建议 `GOPROXY=https://goproxy.cn,direct`）。

```bash
go build ./...
go vet ./...
go test ./...
```

## 运行 reportserv

数据库默认使用 SQLite（零配置，单文件）。启动后监听 `:8080`：

```bash
./reportserv \
  -addr :8080 \
  -db catalog.db \
  -artifacts artifacts \
  -csv ./data
```

`-db` 参数同时决定使用哪种数据库与 SQL 方言：

| `-db` 取值 | 数据库 | 驱动 | 方言 |
| --- | --- | --- | --- |
| `catalog.db`、`/var/lib/goreport/catalog.db`、`:memory:`、`file:…` | SQLite | modernc.org/sqlite | `?` 占位符 |
| `postgres://user:pass@host:5432/dbname` | PostgreSQL | pgx v5 | `$1..$N` 占位符 |
| `postgresql://user@host/dbname?sslmode=disable` | PostgreSQL | pgx v5 | `$1..$N` 占位符 |
| `postgres:…` 或 `host=… dbname=…`（libpq DSN） | PostgreSQL | pgx v5 | `$1..$N` 占位符 |

PostgreSQL 示例：

```bash
# 先建库（可选，任意空库即可，服务启动时自动建表）
createdb goreport

./reportserv \
  -addr :8080 \
  -db 'postgres://user:pass@localhost:5432/goreport?sslmode=disable' \
  -artifacts artifacts \
  -csv ./data
```

启动时会自动执行幂等的 `CREATE TABLE IF NOT EXISTS definitions …`，SQLite 与 PostgreSQL 共用同一份 schema，无需手工迁移。

## PostgreSQL 集成测试

日常测试默认跳过 PostgreSQL 用例；设置 `TEST_PG_DSN` 指向一个可丢弃的测试库后即可跑完整的草稿 → 发布 → 回滚生命周期（用例会自动建表/清表）：

```bash
TEST_PG_DSN='postgres://user:pass@localhost:5432/goreport_test?sslmode=disable' \
  go test ./internal/catalog/ -run TestStorePostgresLifecycle -v
```

## 目录结构

```
cmd/reportserv    HTTP 服务入口：驱动选择（sqlite/pgx）+ 方言探测
cmd/reportgen     离线渲染命令
internal/catalog  定义存储：dialect.go（方言抽象/占位符重绑定）+ store.go
internal/httpapi  REST 路由
internal/engine, render, schema, style, datahub, orchestrator, pipeline, model
spikes            技术验证与调研笔记
```