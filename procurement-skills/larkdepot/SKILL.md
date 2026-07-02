---
name: larkdepot
description: 当需要查飞书表的本地缓存(库存/供应商档案等,抗限流)、注册新飞书表进缓存、或把批量任务结果落库并回传飞书时使用。也用于判断缓存是否可用、以及缓存不可用时怎么降级。
metadata:
  short-description: 飞书本地缓存/写回 CLI
  lang: zh
---

# larkdepot（原 feishu-db）

飞书多维表格本地货站:pull 整表镜像进本地 SQLite(查询零限流),push 把本地写回行推上飞书。**本 skill 是 larkdepot 的唯一操作手册,业务 skill 只引用、不内嵌任何工具细节。**

源码/发版:私有 repo `cunninghamcard-bit/larkdepot`(GitHub Release 分发 musl 静态 binary)。binary 名 `larkdepot`,prod 已在 PATH。

## 查(唯一入口:只读 SQL)

    larkdepot schema      # 先看有哪些表、每张表的真实列名(列名=飞书字段名,会漂移,别凭记忆硬编码)
    larkdepot query sql --sql "SELECT ... WHERE norm(型号)=norm('bav-99')" [--limit N] [--db state]

- `norm(列)`:去 `-`/`/`/空格+大写,型号变体匹配必用。
- `--db cache`(默认)查飞书镜像;`--db state` 查本地写回事实源。
- 多选/人员/附件列存原始 JSON 文本,`json_extract` 拆。
- envelope 带 `freshness.age_s`,过大时提醒用户缓存偏旧(cron 定期 sync)。

## 写回与注册

    larkdepot register "<飞书表URL>" --name 表名 && larkdepot sync   # 纳管人建的新表
    larkdepot state create/write/list + larkdepot push               # 批量结果写回,见配方

## 业务场景配方(references/)

| 场景 | 配方 |
|---|---|
| 库存跨 7 表查询 | [references/inventory-lookup.md](references/inventory-lookup.md) |
| 供应商档案三字段检索 | [references/supplier-search.md](references/supplier-search.md) |
| 批量结果写回飞书 | [references/batch-writeback.md](references/batch-writeback.md) |
| 缓存不可用降级直查 | [references/degraded-direct-query.md](references/degraded-direct-query.md) |

## 查不到 = 没有(工具级事实)

缓存是飞书各表的**完整镜像**(整表同步,非抽样)。命令成功且 `freshness.synced_at` 非空 → 结果即权威,`data` 空 = 源表里确实没有,**不要降级实时查**(同源只会同样空,还更慢、撞限流)。空结果是常态、也是有用的答案。

## 缓存不可用的判定(唯一标准)

仅当任一成立:① `larkdepot` 命令**本身失败**(二进制缺失/报错退出/输出非 JSON);② `freshness.synced_at` 为 **null**(从未同步过)。此时才走降级配方。

## 故障

退出码:0 成功(含查空)/ 1 用法 / 2 环境(未 sync、lark-cli 未授权)/ 3 任务失败。错误 JSON 自带 `hint`,照 hint 办。
