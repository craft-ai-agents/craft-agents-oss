---
name: feishu-db
description: 飞书多维表格本地货站 larkdepot——查库存/供应商走本地 SQLite 缓存(抗限流)，批量结果本地落行后 push 回飞书。查询用 query sql(agent 直写 SQL，norm() 做型号变体归一)。当需要查本地库存/供应商缓存、或把批量任务结果落库回传飞书时使用。
metadata:
  short-description: 飞书本地缓存/写回 CLI
  lang: zh
---

# feishu-db（larkdepot）

源码与发版：独立私有 repo `cunninghamcard-bit/larkdepot`，GitHub Release 分发 musl 静态 binary。这个目录（`procurement-skills/feishu-db/`）不再存放源码或编译产物，只是本 SKILL 的说明文档。

binary 名：`larkdepot`。prod 上已装进 PATH（`/usr/local/bin/larkdepot`），本地开发从 release 拉取或在 larkdepot repo 里自行编译。

## 查（唯一入口：只读 SQL）

先看有哪些表、每张表的真实列名（列名 = 飞书字段名，逐字直取，没有别名映射）：

    larkdepot schema

再直接写 SQL：

    larkdepot query sql --sql "SELECT 型号,数量,单价 FROM 动态库存表 WHERE norm(型号)=norm('BAV99W')"
    larkdepot query sql --sql "SELECT * FROM 供应商档案 WHERE 主营品牌 LIKE '%TDK%'" --limit 50
    larkdepot query sql --sql "SELECT * FROM batch_results WHERE _instance='0702找料'" --db state

- `norm(列)`：去 `-`/`/`/空格 + 转大写，型号变体匹配必用，比如 `norm('bav-99')` 和 `norm('BAV99')` 相等。
- `--db cache`（默认）查飞书镜像缓存；`--db state` 查本地写回事实源（批量结果等）。
- 多选/人员/附件等列存原始 JSON 文本，用 `json_extract` 拆。
- envelope 带 `freshness.age_s`：缓存超过几小时没刷新时提醒用户数据偏旧（cron 定期 `sync`）。
- 每张表的真实列名不保证长期不变（飞书那边可能改字段名/加列），**写 SQL 前先跑一次 `schema` 核对**，不要凭记忆硬编码列名。

## 写回（批量任务结果落库 → 推飞书）

    larkdepot state create --template batch-result --title "0702找料" --app <base_token>
    larkdepot state write "0702找料" --json '{"批次ID":"B1","型号":"BAV99","结果状态":"found","结果JSON":"{...}"}'
    larkdepot push                         # 幂等，失败行下次自动重试

## 注册人建的新飞书表进缓存

    larkdepot register "<飞书表URL(地址栏带 table= 参数)>" --name 表名
    larkdepot sync

## 查不到 = 没有（对所有消费 skill 生效的工具级事实）

缓存是飞书各表的**完整镜像**（每张整表同步，不是抽样）。所以：

- 命令成功且 envelope 里 `freshness.synced_at` 非空 → 结果即权威。`data` 空 = 源表里确实没有，**不要降级去实时查 lark-cli**——查同一个源只会得到同样的空，还更慢、撞限流。
- 空结果是常态、也是有用的答案。不要因为"没查到"就怀疑工具、反复换写法重试。
- `freshness.age_s` 过大（缓存偏旧）是提醒用户的信号，不是降级实时查询的理由。

## 缓存不可用的判定（唯一标准，消费 skill 不要自己发明）

仅当以下任一成立，才算缓存不可用，此时按各消费 skill 自己定义的降级流程直接查 lark-cli（**串行，绝不并发**；遇限流 `800004135` 等几秒重试）：

1. `larkdepot` 命令**本身失败**：二进制缺失 / 报错退出 / 输出非 JSON；
2. `freshness.synced_at` 为 **null**（从未成功同步过）。

## 故障

退出码：0 成功（含查空）/ 1 用法错误 / 2 环境错误（未 sync、lark-cli 未授权）/ 3 任务失败。错误 JSON 自带 `hint`，照 hint 办。
