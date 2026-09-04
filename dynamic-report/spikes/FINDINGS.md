# excelize Spike 发现记录（FINDINGS）

> 范围：设计文档 13.3 节 V1-V4；对应 `spikes/excelize_spike_test.go`。
> 执行环境：Go 1.27.1 / excelize v2.9.0，2026-09-05。

## 0. 模块路径：qax-os 已迁移为 xuri（影响所有 import）

计划中 `go get github.com/qax-os/excelize/v2@v2.9.0` 失败，报错：

```
module declares its path as: github.com/xuri/excelize/v2
        but was required as: github.com/qax-os/excelize/v2
```

原因：excelize 项目从 qax-os 组织迁移到 xuri 组织，go.mod 声明的模块路径为 `github.com/xuri/excelize/v2`。v2.9.0 版本本身存在。
实际采用规范路径：`go get github.com/xuri/excelize/v2@v2.9.0` 成功，锁定实际版本 **v2.9.0**。
后续所有源码 import 一律使用 `github.com/xuri/excelize/v2`。
影响：`internal/render` 及后续任务的 import 路径均以 xuri 为准。

## V1. 条件格式：API 形态与"同范围覆盖"陷阱

- 计划中的 `[]excelize.Format{{Type:"data_bar",Color:"#638EC6"}}` 在 v2.9.0 **不存在的类型**（`go doc` 确认无 `Format` 符号），编译不过；JSON 字符串形态是 v1 时代 API，v2.9.0 也不需要。
- **实际签名**：`func (f *File) SetConditionalFormat(sheet, rangeRef string, opts []excelize.ConditionalFormatOptions) error`。
- data_bar 写法：`{Type:"data_bar", Criteria:"=", MinType:"min", MaxType:"max", BarColor:"#638EC6"}`（字段是 `BarColor`，不是 `Color`）。
- 计划中的 `Type:"top10"` 不存在，对应类型为 `Type:"top"`（`Criteria:"=", Value:"2"`）。`Format` 字段是 `*int`，需 `f.NewConditionalStyle(&excelize.Style{...})` 生成样式 ID。
- **关键发现（影响渲染装配遍）**：对同一 `rangeRef` 连续多次调用 `SetConditionalFormat`，后一次调用会**整体覆盖**前一次（实测 A1:A5 先写 data_bar 再写 top，回读只剩 top）。同范围多条规则必须**合并进一次调用的 opts 数组**，实测一次调用传 2 个规则后，内存回读与重开文件回读均为 2 条规则。
- 结论/影响：渲染器为每个 sheet 维护 `rangeRef -> []rules` 的映射，按范围一次性批量调用 SetConditionalFormat；不允许同范围多次调用。
- 人工验证：同一 rangeRef 重复调用 SetConditionalFormat 会整体覆盖前次规则，与合并一次调用共存 2 条规则的内存回读结论一致（已人工复现）。

## V2. 公式缓存值：v2.9.0 支持双写（先写值、后写公式）

- 验证顺序：`SetCellValue(A3, 30)` 再 `SetCellFormula(A3, "=A1+A2")`，Write 后重新 `OpenReader` 回读：
  - `GetCellFormula` 返回 `"=A1+A2"`（断言通过）；
  - `GetCellValue` 返回 `"30"` —— **缓存值成功保留，不是空字符串**。
- 说明：v2.9.0 的 `SetCellFormula` 不会删除该单元格已有的 `<v>` 缓存值；先写值再写公式即可实现"公式 + 缓存值"双写。顺序必须为"先值后公式"（反序会以值覆盖公式）。
- 结论/影响：**`formula_strategy=formula` 可直接双写，无需降级到 `value`**。保留幂等约束：缓存值应等于公式计算结果（聚合器物化阶段已保证精确值）。兜底 A（打开时强制重算）仍可留作异常保险，但非必须。

## V3. 打印标题：需带 Scope 指向工作表

- 计划形态 `SetDefinedName(&excelize.DefinedName{Name:"_xlnm.Print_Titles", RefersTo:"Sheet1!$1:$1"})` **不报错**，但回读 `Scope="Workbook"`（默认工作簿级）。
- v2.9.0 文档对"行重复顶部"的标准写法要求带 `Scope:"Sheet1"`；实测带 Scope 后回读 `Name="_xlnm.Print_Titles" RefersTo="Sheet1!$1:$1" Scope="Sheet1"`。
- 结论/影响：渲染"每页重复表头行"时按 `SetDefinedName(&excelize.DefinedName{Name:"_xlnm.Print_Titles", RefersTo: sheet+"!$1:$1", Scope: sheet})` 写入；列重复可类推 `RefersTo: sheet+"!$A:$A"`。
- 幂等提示：实现时只写一次带 Scope 的 `_xlnm.Print_Titles`（避免复用无 Scope 形态产生两条重复记录）；工具在新旧形态混合写入时会残留重复项。（基于实测：无 Scope 写入会残留下一条记录）

## V4. 写入性能：1 万行级无压力（远低于 10s 上限）

- 实测：10000 行 x 6 列逐格 `SetCellValue`（60000 次调用）+ `Write` 到 bytes.Buffer 共约 **0.13s~0.15s**（SetCellValue 阶段约 47~49ms），无任何超时。口径澄清：49ms 为 SetCellValue 阶段耗时，`f.Write` 另计（共约 0.13s）。
- 输出文件字节数：**375,723 字节**（约 367 KB）。
- 结论/影响：逐格 SetCellValue 对当前报表规模完全够用，渲染层无需 StreamWriter 优化；若后续单表超数十万行，可再评估 `SetSheetRow`/`StreamWriter`。

## 汇总对后续渲染任务的影响

1. import 路径统一 `github.com/xuri/excelize/v2`（版本 v2.9.0）。
2. 条件格式：`[]excelize.ConditionalFormatOptions`；data_bar 用 `BarColor`；Top-N 用 `Type:"top"` + `NewConditionalStyle` 的 `*int`；**同范围多规则合并为一次调用**。
3. 公式：先 `SetCellValue`（缓存值）后 `SetCellFormula`，可双写，`formula_strategy` 无需降级（`.xlsx` 由 pandas/openpyxl 打开时已有值）。
4. 打印标题：`_xlnm.Print_Titles` 必须带 `Scope` 指向工作表。