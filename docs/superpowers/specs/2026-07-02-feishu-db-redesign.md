# feishu-db 重设计文档 — 两库分立 + 原子换库 + 声明式表定义

日期：2026-07-02
状态：**部分被取代** —— §4（TableDef 静态常量）、§6（canned queries）、§10 兼容段由 `2026-07-02-feishu-db-dynamic-tables-design.md` 修订取代；两库分立、原子换库、模块化、构建部署、测试基线继续有效
对象：`procurement-skills/feishu-db/`（Rust CLI，飞书库存/供应商本地 SQLite 缓存，已上 prod）

## 0. 决策记录（用户拍板）

1. **方案甲：按新模块边界整形，不推倒重写。** 已验证的实现细节原封保留：并发 8 + 退避重试（12 并发偶发空 stdout 的实测结论）、型号变体匹配、docker rust:alpine musl 静态构建（prod 内核 5.15 门槛）、cron 部署方式。
2. **CLI 契约遵循 scrape-service spec 第 6 节**（agent-friendly 八条），两个 CLI 同一契约。
3. **搁置 diff 的处置**：`optimize/procurement-substitute-eval` 分支上 batch_results 进缓存库的未提交实现不合入；其**需求**（批量编排结果落库而非对话粘贴）被本设计收编进 agent-state.db 重新实现。
4. **与 scrape-service 不共库**：scrape 的 job/results 是可抛弃缓存，agent-state 是事实源，生命周期不同，各管各的文件。

## 1. 动机（调研 B 结论）

- **batch_results 混进缓存库是最大设计错误**：缓存是可重建的易失物，batch_results 是 agent 产出的事实源，生命周期相反的数据同居一个文件，导致"重建换库"不可行。
- **同步非原子**：7 张表各自事务逐个 delete+insert，中途挂掉留下半新半旧快照，读者可能读到中间态。
- **schema 无演进能力**：`CREATE TABLE IF NOT EXISTS` 只能加表不能改列，改字段要手动删库。
- db.rs 一个文件 334 行干四件事（schema/同步写入/查询/batch），边界不清。
- 对标调研（Airbyte 协议/dlt/Steampipe/sqlite-utils/Litestream/refinery）结论：可借鉴的是**原子换库、生命周期拆库、声明式表定义、schema-mismatch 免疫、canned queries**；明确不适用的是增量同步/cursor、CDC、FTS、连接池、gRPC 插件隔离——71k 行全量分钟级搞定，全是负资产。

## 2. 总体形态——一个 binary，两个数据库

```
feishu-db (musl 静态 binary，构建/部署流程不变)
├── feishu-cache.db   缓存库：飞书表的本地物化视图。可抛弃、可重建、
│                     只被 sync 整体替换，agent 永远只读
└── agent-state.db    状态库：agent 产出的事实源（batch_results 等）。
                      不可抛弃、真迁移、读写
```

第一因：**按数据生命周期分文件**。拆开后缓存库获得黄金性质——任何时刻整个文件可被扔掉——后续所有简化（原子换库、无迁移、版本门=删库重建）都由此派生。

## 3. 模块边界（7 个文件，单向依赖）

```
main.rs ──→ serve.rs ──→ schema.rs ←── store.rs ←── map.rs ←── source.rs
        └─→ state.rs ──→ (agent-state.db)
```

| 文件 | 职责（一件事） | 对外接口 | 绝不碰 |
|---|---|---|---|
| `schema.rs` | 表定义 + 版本：`TABLES: &[TableDef]` + `CACHE_SCHEMA_VERSION` | `TableDef`/`ColDef` | 网络、SQLite 连接 |
| `source.rs` | 唯一碰 lark-cli 处：并发 8 翻页、退避重试（现 fetch.rs 原封搬入） | `fetch_table(def) -> Vec<RawRecord>` | 字段语义、SQL |
| `map.rs` | `RawRecord → Row` 纯函数（现 coerce.rs + pick），产出 drift 报告 | `map_rows(def, raws) -> (Vec<Row>, Drift)` | 任何 I/O |
| `store.rs` | staging 写入 + 原子换库 | `build_cache(tables) -> SyncReport` | 飞书、查询逻辑 |
| `serve.rs` | canned queries 注册表 + JSON envelope 输出 | `run_query(name, params)` | 写缓存库（只读打开） |
| `state.rs` | agent-state.db 全部读写 + `_migrations` 迁移 | batch 域命令 | 缓存库 |
| `main.rs` | clap 定义 + 分发 + 错误→JSON→退出码 | — | 业务逻辑 |

## 4. 核心数据结构

### 4.1 TableDef——四处消费一处定义

```rust
pub struct TableDef {
    pub name: &'static str,               // SQLite 表名
    pub app_token: &'static str,
    pub table_id: &'static str,
    pub columns: &'static [ColDef],
}
pub struct ColDef {
    pub col: &'static str,                // SQLite 列名
    pub sources: &'static [&'static str], // 飞书字段名候选（别名链，防重命名）
    pub kind: Kind,                       // Text | Int | Real | Json
}
```

source 翻页、store 建表灌行、map 取值转型、`schema` 子命令输出契约，全部数据驱动。**加表 = 加一个数组元素 + 版本号 +1，其余代码零改动。**

### 4.2 缓存库版本与元数据

- `PRAGMA user_version` = `CACHE_SCHEMA_VERSION`。任何命令打开缓存库版本不符 → 结构化错误提示跑 `sync`（sync 无条件重建即修复）。**缓存库没有迁移代码**——可抛弃的东西不迁移。
- `_sync_meta` 表：每表行数、sync 起止时刻、drift warnings JSON。`status` 与查询 envelope 的 freshness 由此读出。

## 5. 同步链路（原子换库）

```
sync = 开 feishu-cache.db.tmp-<pid>
     → 逐表：fetch(并发8) → map → INSERT（一表一事务，tmp 库无所谓）
     → 全部成功：写 _sync_meta → fsync → rename() 覆盖正式路径
     → 任一失败：删 tmp，退出码 3，旧库一字节未动
```

- **崩溃 = 无事发生**：残留 tmp 是垃圾，下次 sync 顺手清；"半新快照"状态不存在，也就没有处理它的代码。
- **读者并发安全靠 POSIX rename 语义**：在读进程握旧 inode 读完整旧快照，新打开者见新快照。零锁。
- **drift 免疫（Airbyte 铁律：永不因 mismatch 失败）**：声明字段缺失 → 空值 + warning；飞书新增未声明字段 → warning；均不中断 sync。字段改名的修复 = 改一行 `sources` 别名链。

## 6. 查询层（canned queries + agent-friendly CLI）

```rust
pub struct CannedQuery {
    pub name: &'static str,
    pub sql: &'static str,               // 命名参数 SQL
    pub params: &'static [&'static str],
    pub description: &'static str,
}
```

命令面：

```
feishu-db sync [--table <name>]
feishu-db query <name> --param k=v [--limit N] [--fields a,b]
feishu-db status
feishu-db schema        # 机器可读全契约：表定义 + canned queries + 退出码表
feishu-db state <cmd>   # agent-state 域（batch-upsert / batch-list / ...）
```

统一输出 envelope，**freshness 强制随行**：

```json
{"schema_version": 2, "data": [...], "truncated": false,
 "freshness": {"synced_at": "...", "age_s": 7423}}
```

CLI 契约同 scrape-service spec 第 6 节八条：默认 JSON、永不交互、结构化错误带 hint、退出码语义固定（0=成功含查空/1=用法/2=环境/3=任务失败）、`schema` 自描述（SKILL.md 引用不手抄）、有界输出、`schema_version` 永不静默变更。

**兼容（Never break userspace）**：`query --part X`、`supplier --brand Y` 旧写法保留为别名，直至 `procurement-local-inventory-lookup`、`procurement-supplier-shortlist` 两个消费 skill 改完；cron 的 `feishu-db sync` 命令名、prod DB 路径 `/home/craft/.craft-agent/feishu-cache.db` 均不变。

## 7. agent-state.db

- `state.rs` 独管；`_migrations` 表 + 内嵌 SQL 数组做真迁移（refinery 思想的零依赖实现，musl 友好）。
- 首张表 `batch_results`：收编搁置 diff 的需求（批量编排结果落库、子会话短状态回传），重新实现，不合入旧代码。
- 库文件与缓存库同目录、独立文件；与 scrape-service 的 job 库不共文件。

## 8. 明确不做

增量同步/cursor、CDC、FTS、连接池、gRPC/进程隔离、HTTP 接口、缓存库迁移框架。理由同 §1：71k 行全量分钟级，复杂度与问题规模不匹配。

## 9. 测试策略

- `map.rs` fixture 测试：字段缺失/改名/新增三类 drift case；
- 原子性：sync 中途 kill -9，正式库完好、tmp 可清；
- 版本门：user_version 不符时全命令统一结构化错误；
- envelope 快照测试：schema_version/freshness/truncated；
- state 迁移测试：空库→最新、逐版本推进；
- 构建验证：docker rust:alpine musl 编译 + prod 内核 5.15 实机；
- 性能不回归：全量 8 表 71k 行 sync 时长基线 55-92s。

## 10. 体量与迁移

- 估算 700→900 行，仍一个 binary、7 个源文件。
- 上线顺序：先发 binary（旧命令别名兼容，prod 无感）→ 改两个消费 skill 用新命令面 → 移除别名（一个版本期后）。
- batch_results 数据无需搬迁（搁置 diff 未上 prod，prod 缓存库中无此表）。
