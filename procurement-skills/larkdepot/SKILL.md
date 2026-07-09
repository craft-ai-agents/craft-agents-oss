---
name: larkdepot
description: 当需要查飞书表的本地缓存(库存/供应商档案等,抗限流)、注册新飞书表进缓存、或把批量任务结果落库并回传飞书时使用。也用于判断缓存是否可用、以及缓存不可用时怎么降级。
metadata:
  short-description: 飞书本地缓存/写回 CLI
  lang: zh
---

# larkdepot（原 feishu-db）

飞书多维表格本地货站:pull 整表镜像进本地 SQLite(查询零限流),push 把本地写回行推上飞书。**本 skill 是 larkdepot 的唯一操作手册,业务 skill 只引用、不内嵌任何工具细节。** 命令名 `larkdepot`(在 PATH)。

## 查

    larkdepot schema      # 先看有哪些表、每张表的真实列名(列名=飞书字段名,会漂移,别凭记忆硬编码)

    # 首选:结构化搜索,免写 SQL(flag 语义与 lark-cli 同构,查本地缓存、零限流)
    larkdepot base +record-search --keyword "MT41K256M16TW-107 IT:P" --search-field 型号   # 省 --table-id = 搜全部缓存表
    larkdepot base +record-search --table-id 供应商档案 --keyword 继电器 --search-field 优势产品 [--search-field 列]... [--field-id 只回这些列]... [--limit 1-200]

    # 单表浏览/看列
    larkdepot base +record-list --table-id <表名或tbl开头ID> [--limit 1-200] [--offset N]
    larkdepot base +field-list  --table-id <表名或tbl开头ID>

    # 逃生舱:聚合/JOIN/json_extract 等 record-search 覆盖不了的才写 SQL
    larkdepot query sql --sql "SELECT COUNT(*) FROM 供应商档案 WHERE \"供应商等级\"='A'" [--limit N] [--db state]

- **查数据首选 `+record-search`**:命中 = norm 变体相等(bav-99 命中 BAV99)或忽略大小写子串,型号匹配与名称模糊一把抓,不用选模式;行自带 `_table` 标注;搜索字段在所有目标表都不存在会报用法错(带 hint),打错字段名不会伪装成"查无此物"。
- 写 SQL 时(仅逃生舱):**列名一律双引号**(列名常带 `/` 空格 括号,如 `"目标价/价格"`、`"采购负责人 (人员 )"`,裸写被当除法/语法错);`norm(列)` 归一化型号变体,NULL 行安全跳过;多选/人员/附件列存原始 JSON 文本,`json_extract` 拆。
- `--db cache`(默认)查飞书镜像;`--db state` 查本地写回事实源(仅 query sql)。
- 输出一律是 larkdepot envelope(行对象数组);`freshness.age_s` 过大时提醒用户缓存偏旧(cron 定期 sync)。

## 写回与注册

    larkdepot register "<飞书表URL>" --name 表名 && larkdepot sync   # 纳管人建的新表
    larkdepot state create/write/list + larkdepot push               # 批量结果写回,见配方

表清单/写回模板都是运行时配置(本目录 `config/`),初始化见 setup 配方。

## 业务场景配方(references/)

| 场景 | 配方 |
|---|---|
| 初始化/部署(seed+模板导入) | [references/setup.md](references/setup.md) |
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
