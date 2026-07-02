# feishu-db 动态表设计 — 运行时注册 + 自动发现 + 出箱写回

日期：2026-07-02
状态：已与用户逐节评审通过，待实现规划
对象：`procurement-skills/feishu-db/`（Rust CLI，已上 prod）
关系：**修订并取代** `2026-07-02-feishu-db-redesign.md` 的 §4（TableDef 静态常量）、§6（canned queries）、§10 兼容段；其余（两库分立、原子换库、模块化、构建部署、测试基线）全部继承。

## 0. 决策记录（用户拍板）

1. **冲突模型：agent 独占写**。写回目标表在飞书侧只被查看，不被编辑。同步 = 单向上行推送，无双向合并。
2. **写回表：实例动态、结构模板化**。列结构按业务类型在代码里声明成模板；运行时按模板在飞书实例化新表。
3. **读侧动态**：人在飞书新建的表，不重编译即可注册进缓存 sync；agent 新建的写回表本地直接可查。
4. **列结构来源：从飞书自动发现**。注册只给表 URL/token，sync 时拉字段列表自动映射，飞书改列自动跟随。
5. **推送时机：显式 `push` 命令**。agent 写完本地自己推，失败行下次 push 自动重试。
6. **不做兼容**。消费 skill 与 binary 同仓同源、同一人原子部署到同一 prod——旧命令别名、稳定列名 overrides、canned queries 全部不做。cron 的 `sync` 命令与 prod DB 路径保持，那是运维事实不是兼容包袱。
7. **`query sql` 是一等公民**。agent 会写 SQL，只读任意 SQL 是唯一查询入口。
8. **独立 git repo + Release 分发**（2026-07-02 追加拍板）：feishu-db 从 monorepo 拆出单独私有 repo（全新历史，旧实现历史留 monorepo 考古）；binary 走 GitHub Release 按版本分发，skills 仓库从此不存任何编译产物。scrape-service 本次不动。

## 1. 动机

- 读链路已有本地缓存抗限流（前一 spec），但表集合钉死在编译期常量里，人在飞书建新表要改代码重发 binary。
- 写链路没有：agent 用 lark-cli 逐条写飞书，吃限流、逐条慢、中途断了难收拾。需求是本地写表 + 显式同步上飞书。
- 前一 spec 的 agent-state.db 只装 batch_results；本设计把它升级为**写回事实源 + 表注册中心**。

## 2. 总体形态——一个 binary，两个库，各多一个角色

```
feishu-db
├── feishu-cache.db   下行缓存：_registry 里所有 pull 表的物化视图。
│                     可抛弃、原子换库、agent 只读（继承前一 spec）。
└── agent-state.db    事实源：_registry(表注册) + _config + 各模板本地数据表。
                      agent 读写，真迁移；push 把 dirty 行推上飞书。
```

第一因：**表定义从代码常量降为 `_registry` 里的数据**。原 7 张核心表不再是代码里的 `TABLES` 数组，而是首次迁移预置进 `_registry` 的 7 行。sync 眼里只有一种表：registry 里 `direction=pull` 的行——"静态表 vs 注册表"两条代码路径被消灭。注册信息在 state 库，缓存库依然随时可扔、重建无损。

## 3. 核心数据结构

### 3.1 `_registry`（state 库，数据）——"表从哪来"的唯一答案

```sql
_registry(name TEXT PRIMARY KEY,
          direction TEXT CHECK(direction IN ('pull','push')),
          app_token TEXT, table_id TEXT,
          template TEXT,          -- push 表：所用模板名；pull 表 NULL
          enabled INTEGER DEFAULT 1,
          created_at TEXT)
```

- 人建的新表：`feishu-db register <飞书表URL>` 解析 token 落一行，下次 sync 自动纳入。
- agent 建的表：`state create --template …` 自动落一行 `direction=push`。
- 预置 7 行核心表由 state 迁移写入。

### 3.2 `TableTemplate`（代码常量）——写回表的结构模板

```rust
pub struct TableTemplate {
    pub name: &'static str,          // "batch-result"
    pub local_table: &'static str,   // state 库本地表名
    pub fields: &'static [FieldDef], // 飞书字段名 + 类型；建飞书表和本地表共用
}
```

加一种业务类型 = 加一个模板 + 一条 state 迁移。这是唯一留在代码里的"声明"——模板是业务契约，理应进代码评审。

### 3.3 实例 = 行，不是表

同模板所有实例**共用一张本地表**，`_instance` 列区分。"agent 建新表"在本地侧只是 `_registry` 插一行 + 飞书建表，**零动态 DDL**——state 库 schema 永远由迁移管。每行另带出箱三列：

- `_row_key`：客户端生成 UUID，同时写进飞书表的 `row_key` 文本字段（模板自动附带，视图里隐藏），push 幂等的锚点；
- `_record_id`：飞书回填；
- `_dirty`：待推标记。

### 3.4 pull 表列结构不落任何地方

每次 sync 现场从飞书字段列表发现（飞书类型 → Text/Int/Real/Json 纯函数映射），建进 tmp 库，列名 = 飞书字段名（含中文）。缓存可抛弃，列结构连持久化的资格都没有；飞书改列下次 sync 自动跟随。`_sync_meta` 记录每表实际列清单，`schema` 子命令由此输出，agent 写 SQL 前先看它。

## 4. 统一抽象：`ResolvedTable`

```rust
pub struct ResolvedTable {
    pub name: String,
    pub app_token: String,
    pub table_id: String,
    pub columns: Vec<Col>,
}
```

| 表的来源 | columns 从哪来 |
|---|---|
| 预置核心表 | sync 时自动发现 |
| 人注册的表 | sync 时自动发现 |
| agent 建的 push 表 | 模板即列，不走发现 |

解析之后 fetch → map → store 管线不知道表是谁。只有一条路：registry 行 → ResolvedTable → 管线。

## 5. 两条同步链路

### 5.1 下行 pull（cron 照跑，原子换库继承）

```
sync = registry 取 pull 行 → 逐表: list_fields → 发现列 → ResolvedTable
     → fetch(并发8+退避，原封不动) → map → tmp 库 INSERT
     → 全成功: 写 _sync_meta → fsync → rename() 原子换库
     → 任一失败: 删 tmp（按前缀清理所有残留 tmp，不只本 pid），退出 3，旧库一字节未动
```

与前一 spec 唯一区别：管线入口从常量数组换成 registry + 发现。

### 5.2 上行 push（出箱模式）

```
push [--table x] = registry 取 push 行(enabled) → 逐实例:
  ① 有待建行时，先拉飞书现存 _row_key 对账
     （防上次 create 成功但回填前崩溃 → 重复行）
  ② _record_id IS NULL 的行 → 分块 batch_create → 回填 _record_id
  ③ _dirty=1 且有 _record_id 的行 → 分块 batch_update → 清 _dirty
  失败行原地不动，envelope 逐行报错，退出 3；下次 push 天然重试
```

push **幂等、可任意重跑**——出箱 + row_key 对账买来的性质，崩溃恢复零专门代码。写方向并发保守（串行分块 + 退避），读方向的并发 8 不适用于写限流。

## 6. 模块边界（8 个文件，单向依赖）

```
main.rs ─→ serve.rs ─→ (cache.db / state.db 只读)
       ├─→ store.rs ←─ map.rs ←─┐
       ├─→ push.rs ──────────→ source.rs ←─ schema.rs
       └─→ state.rs (state.db 全部读写 + 迁移 + registry)
```

| 文件 | 职责（一件事） | 绝不碰 |
|---|---|---|
| `schema.rs` | 模板常量 + Kind + 飞书类型→Kind 映射纯函数 | 网络、SQLite 连接 |
| `source.rs` | **唯一碰 lark-cli 处**：list_fields / fetch_records / create_table / batch_create / batch_update（并发与退避原封继承 fetch.rs） | 字段语义、SQL |
| `map.rs` | RawRecord → Row 纯函数 + drift 报告 | 任何 I/O |
| `store.rs` | tmp 库写入 + 原子换库 | 飞书、查询逻辑 |
| `serve.rs` | `query sql` 只读执行 + envelope | 写任何库 |
| `state.rs` | state 库迁移 + `_registry`/`_config` + 本地行读写 | 缓存库 |
| `push.rs` | 出箱编排：读 state → 调 source → 回填 | 直接碰 lark-cli |
| `main.rs` | clap 分发 + 错误→JSON→退出码 | 业务逻辑 |

## 7. 命令面

```
feishu-db sync [--table n]                     # cron 命令名不变
feishu-db register <飞书表URL> [--name n]       # 纳管人建的表
feishu-db query sql --sql "SELECT …" [--db cache|state，默认 cache] [--limit N]
feishu-db state create --template t --title x  # 建实例：飞书建表 + registry 落行
feishu-db state write <实例> --json '<行>' [--stdin]   # 本地写，--stdin 批量
feishu-db state list <实例> [--filter k=v]
feishu-db push [--table 实例]                   # 出箱推送
feishu-db status                               # 缓存 freshness + push 积压
feishu-db schema                               # 模板 + registry + 每表列清单 + 退出码表
```

CLI 契约继承 scrape-service spec 第 6 节八条：默认 JSON、永不交互、结构化错误带 hint、退出码 0=成功/1=用法/2=环境/3=任务失败、`schema` 自描述、有界输出、envelope 带 `schema_version` + freshness、永不静默变更。

## 8. 错误处理

- **push 部分失败**：envelope 逐行 `{row_key, error, hint}`，退出 3。行独立、无回滚概念。
- **发现失败**（表被删/无权限）：整体 sync 失败（原子语义不变），hint 提示禁用该注册项或查权限。
- **`query sql` 防线**：只读打开 + 无 LIMIT 自动包一层（`truncated: true`）+ 超时。写语句在只读连接天然报错，不做 SQL 解析。
- **`state write` 校验**：JSON 字段对不上模板 → 退出 1，报缺什么多什么。写入时挡住，不留到 push 才炸。

## 9. 明确不做

前一 spec §8 全保留（增量同步/CDC/FTS/连接池/gRPC/HTTP/缓存迁移框架），另加：

- **双向同步/冲突合并**——agent 独占写已拍板；
- **动态列结构**——实例动态、结构进代码评审；
- **兼容层**——旧命令别名、overrides 稳定列名、canned queries 均不做（决策 6/7）。

## 10. 测试策略

- 发现映射：飞书字段类型 → Kind fixture 测试，含字段消失 drift；
- push 幂等：create 成功、回填前 kill -9 → 重跑 push，row_key 对账后飞书无重复行（假 lark-cli 脚本模拟）；
- 实例即行：create/write/push/list 全链路 roundtrip；
- registry 预置：空 state 库迁移后 7 张核心表在位、direction/token 正确；
- `schema` 输出列清单与 `_sync_meta` 一致；
- 继承：原子性 kill -9、版本门、envelope 快照、state 迁移逐版本、musl 构建（docker rust:alpine，prod 内核 5.15）、全量 sync 55-92s 性能基线。

## 11. 仓库形态与分发（决策 8）

- **独立私有 repo**（GitHub，`cunninghamcard-bit` 名下），全新历史；实现按本 spec 重写，不搬旧 `src/`。两份 feishu-db spec 随迁至新 repo 的 `docs/`，monorepo 里留指路存根。
- **分发 = GitHub Release**：docker rust:alpine musl 静态编译（prod 内核 5.15 门槛不变）→ 打 tag 出 release 附 binary；prod 部署脚本按版本号拉取到现路径。skills 仓库（`procurement-skills/feishu-db/`）只留 SKILL.md，**不再 commit 任何编译产物**，2.9MB blob 停止进 git 历史。
- cron 命令、prod DB 路径、`--as user` 授权前提均不受拆分影响。

## 12. 体量与上线

- 估算 1000~1200 行，8 个源文件。超出前一 spec 的部分全在 push.rs 与 source.rs 写方向——真需求撑起来的行数。
- 上线 = release binary + 两个消费 skill（`procurement-local-inventory-lookup`、`procurement-supplier-shortlist`）同批原子部署；skill 内查询改写为 `query sql`。
- 搁置 diff（batch_results 进缓存库）照原决定丢弃，其需求由模板 + `state write/list` 收编。
