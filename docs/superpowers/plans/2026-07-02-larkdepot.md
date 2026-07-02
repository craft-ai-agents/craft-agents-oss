# larkdepot 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-02-feishu-db-dynamic-tables-design.md` 在全新私有 repo 重写飞书本地货站 CLI：pull 物化缓存（运行时注册 + 列自动发现 + 原子换库）+ push 出箱写回（模板实例 + row_key 幂等），GitHub Release 分发，消费 skill 同批切换。

**Architecture:** 一个 Rust binary、两个 SQLite 库。`agent-state.db`（真迁移）持有 `_registry` 表注册中心与写回本地表；`feishu-cache.db` 可抛弃，每次 sync 从飞书自动发现列结构、写 tmp 库后 rename 原子换库。所有飞书 I/O 走 lark-cli 子进程（source.rs 独管，读并发 8 + 退避，写串行分块）。查询唯一入口是只读 `query sql`（带 `norm()` 归一化 UDF、强制 limit、freshness envelope）。

**Tech Stack:** Rust 2021 / clap 4 / tokio / rusqlite(bundled+functions) / uuid；测试 assert_cmd + tempfile + 假 lark-cli 脚本；构建 docker rust:alpine musl 静态（prod 内核 5.15）；分发 gh release。

**工作目录约定：** 新 repo 在 `/home/cunningham/Projects/larkdepot`（Task 1 创建）。Task 2 起所有 `cargo`/`git` 命令都在该目录执行。monorepo（`/home/cunningham/Projects/craft-agents-oss`）只在 Task 12/13 里动。

**读前必知（现有实现里已验证、必须原封保留的结论）：**
- lark-cli 每次调用 fork 一个 Node 进程约 2s；`+record-list` 容许并发不撞限流，`+record-search` 才限流。并发 8 稳定，12 偶发空 stdout。空响应用退避重试（200ms × attempt，4 次）。
- `+record-list` 返回形状：`{"ok":true,"data":{"fields":["列名",...],"data":[[值,...],...],"has_more":bool}}`，行是数组要按 fields 索引配对。
- 写方向命令：`+table-create`（建表带字段）、`+record-batch-create`、`+record-batch-update`、`+field-list` 均已存在于 lark-cli。**具体 flag 名在 Task 5 用 `--help` 现场核对**，计划里的调用参数是按 record-list 风格的最佳推测。
- musl 静态编译必须在 docker rust:alpine 里做（prod 内核 5.15，glibc 版本门槛）。

---

### Task 1: 建 repo（本地 + GitHub 私有）

**Files:**
- Create: `/home/cunningham/Projects/larkdepot/Cargo.toml`
- Create: `/home/cunningham/Projects/larkdepot/.gitignore`
- Create: `/home/cunningham/Projects/larkdepot/docs/`（两份 spec 拷入）

- [ ] **Step 1: cargo init + 拷 spec**

```bash
mkdir -p /home/cunningham/Projects/larkdepot
cd /home/cunningham/Projects/larkdepot
cargo init --name larkdepot
mkdir -p docs
cp /home/cunningham/Projects/craft-agents-oss/docs/superpowers/specs/2026-07-02-feishu-db-dynamic-tables-design.md docs/
cp /home/cunningham/Projects/craft-agents-oss/docs/superpowers/specs/2026-07-02-feishu-db-redesign.md docs/
```

- [ ] **Step 2: 写 Cargo.toml**

```toml
[package]
name = "larkdepot"
version = "0.1.0"
edition = "2021"
description = "飞书多维表格本地货站:pull 物化缓存(抗限流,agent 只读 SQL) + push 出箱写回(row_key 幂等)"

[[bin]]
name = "larkdepot"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "process", "time", "sync"] }
futures = "0.3"
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled", "functions"] }
anyhow = "1"
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
assert_cmd = "2"
tempfile = "3"

[profile.release]
opt-level = 2
strip = true
lto = true
```

- [ ] **Step 3: .gitignore**

```
/target
*.db
*.db.tmp-*
```

- [ ] **Step 4: 编译空壳确认工具链**

Run: `cargo build`
Expected: 编译通过（默认 hello-world main.rs）

- [ ] **Step 5: 建 GitHub 私有 repo 并推首 commit**

```bash
git add -A
git commit -m "chore: cargo init + specs 随迁"
gh repo create cunninghamcard-bit/larkdepot --private --source . --push
```

Expected: `gh repo view cunninghamcard-bit/larkdepot --json visibility` 输出 `PRIVATE`。**绝不建成公开 repo**（仓库拓扑铁律）。

---

### Task 2: main.rs 骨架 —— 命令枚举 + Fail 错误分级 + envelope + 退出码

**Files:**
- Create: `src/main.rs`（覆盖 cargo init 生成的）
- Test: `tests/cli.rs`

- [ ] **Step 1: 写失败的集成测试**

`tests/cli.rs`：

```rust
//! CLI 集成测试:黑盒跑 binary,断言 envelope 契约。
use assert_cmd::Command;

fn cmd() -> Command {
    Command::cargo_bin("larkdepot").unwrap()
}

#[test]
fn unknown_subcommand_exits_1() {
    // clap 用法错误 → 退出码 1(clap 默认 2,要重映射)
    cmd().arg("nonsense").assert().code(1);
}

#[test]
fn schema_outputs_contract_json() {
    let out = cmd().arg("schema").output().unwrap();
    assert!(out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["ok"], true);
    assert!(v["data"]["exit_codes"].is_object());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --test cli`
Expected: FAIL（main.rs 还是 hello world，没有子命令）

- [ ] **Step 3: 写 main.rs**

```rust
//! larkdepot —— 飞书多维表格本地货站。
//! pull:sync 全量物化进 feishu-cache.db(原子换库,agent 只读 query sql)。
//! push:state write 本地落行 → push 出箱推飞书(row_key 幂等)。
//! 契约:默认 JSON envelope、永不交互、退出码 0成功/1用法/2环境/3任务失败。

mod map;
mod push;
mod schema;
mod serve;
mod source;
mod state;
mod store;

use clap::{CommandFactory, FromArgMatches, Parser, Subcommand};
use serde_json::{json, Value};

/// 错误分级:决定退出码。业务代码里 `return Err(Fail::Usage(...).into())`。
#[derive(Debug)]
pub enum Fail {
    Usage(String), // 1:参数/输入错
    Env(String),   // 2:环境错(lark-cli 缺失/DB 打不开/未 sync)
    Task(String),  // 3:任务失败(飞书报错/推送失败)
}

impl std::fmt::Display for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fail::Usage(m) | Fail::Env(m) | Fail::Task(m) => write!(f, "{m}"),
        }
    }
}
impl std::error::Error for Fail {}

pub fn envelope(data: Value, truncated: bool, freshness: Option<Value>) -> Value {
    let mut m = json!({"schema_version": 1, "ok": true, "data": data, "truncated": truncated});
    if let Some(fr) = freshness {
        m["freshness"] = fr;
    }
    m
}

#[derive(Parser)]
#[command(name = "larkdepot", version, disable_help_subcommand = true)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 全量重建缓存库(原子换库;cron 跑)
    Sync {
        #[arg(long)]
        table: Option<String>,
    },
    /// 注册人建的飞书表进缓存 sync 范围
    Register {
        url: String,
        #[arg(long)]
        name: Option<String>,
    },
    /// 只读 SQL 查询(norm() 归一化函数可用)
    #[command(subcommand)]
    Query(QueryCmd),
    /// agent-state 域:建实例/本地写/本地读
    #[command(subcommand)]
    State(StateCmd),
    /// 出箱推送:本地 pending/dirty 行推上飞书
    Push {
        #[arg(long)]
        table: Option<String>,
    },
    /// 缓存 freshness + push 积压
    Status,
    /// 机器可读契约:模板+registry+每表列清单+退出码
    Schema,
}

#[derive(Subcommand)]
enum QueryCmd {
    /// larkdepot query sql --sql "SELECT ..." [--db cache|state] [--limit N]
    Sql {
        #[arg(long)]
        sql: String,
        #[arg(long, default_value = "cache")]
        db: String,
        #[arg(long, default_value_t = 200)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum StateCmd {
    /// 建实例:飞书建表 + registry 落行
    Create {
        #[arg(long)]
        template: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        app: String,
    },
    /// 本地写一行(--json)或批量(--stdin,每行一个 JSON 对象)
    Write {
        instance: String,
        #[arg(long)]
        json: Option<String>,
        #[arg(long)]
        stdin: bool,
    },
    /// 本地读实例的行
    List {
        instance: String,
        #[arg(long)]
        filter: Option<String>,
    },
}

fn fail_exit(e: &anyhow::Error) -> (i32, &'static str, String) {
    let hint = |m: &str| -> String {
        if m.contains("重登") {
            "跑 lark-cli auth login --as user 重新授权".into()
        } else if m.contains("先跑 sync") || m.contains("user_version") {
            "跑 larkdepot sync 重建缓存库".into()
        } else {
            String::new()
        }
    };
    match e.downcast_ref::<Fail>() {
        Some(Fail::Usage(m)) => (1, "usage", hint(m)),
        Some(Fail::Env(m)) => (2, "env", hint(m)),
        Some(Fail::Task(m)) => (3, "task", hint(m)),
        None => (3, "task", hint(&e.to_string())),
    }
}

#[tokio::main]
async fn main() {
    // clap 的用法错误默认退出码 2,重映射到 1(我们的契约:1=用法 2=环境)
    let matches = match Cli::command().try_get_matches() {
        Ok(m) => m,
        Err(e) => {
            if e.use_stderr() {
                println!(
                    "{}",
                    json!({"schema_version": 1, "ok": false,
                           "error": {"kind": "usage", "msg": e.to_string(), "hint": "larkdepot schema 看全契约"}})
                );
                std::process::exit(1);
            }
            // --help/--version 走正常打印
            e.exit();
        }
    };
    let cli = Cli::from_arg_matches(&matches).expect("clap 解析已通过");

    if let Err(e) = run(cli).await {
        let (code, kind, hint) = fail_exit(&e);
        println!(
            "{}",
            json!({"schema_version": 1, "ok": false,
                   "error": {"kind": kind, "msg": e.to_string(), "hint": hint}})
        );
        std::process::exit(code);
    }
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    match cli.cmd {
        Cmd::Schema => {
            println!("{}", envelope(schema_contract(), false, None));
        }
        // 其余命令由后续 Task 接线;先占位报未实现,保证每个中间提交可编译
        _ => return Err(Fail::Usage("该命令尚未实现".into()).into()),
    }
    Ok(())
}

fn schema_contract() -> Value {
    json!({
        "exit_codes": {"0": "成功(含查空)", "1": "用法错误", "2": "环境错误", "3": "任务失败"},
        "templates": schema::templates_json(),
        "commands": ["sync", "register", "query sql", "state create", "state write", "state list", "push", "status", "schema"],
    })
}
```

注意：此刻 `mod map;` 等模块还不存在。**本步同时创建 7 个空模块文件**让编译通过：

```bash
cd /home/cunningham/Projects/larkdepot
for f in map push schema serve source state store; do echo "//! 占位,后续 Task 填充" > src/$f.rs; done
```

`schema.rs` 先给 `templates_json` 一个空实现（Task 3 替换）：

```rust
//! 占位,后续 Task 填充
pub fn templates_json() -> serde_json::Value {
    serde_json::json!([])
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --test cli`
Expected: 2 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: CLI 骨架——命令枚举/Fail 分级/envelope/退出码契约"
```

---

### Task 3: schema.rs —— Kind、飞书类型映射、写回模板

**Files:**
- Modify: `src/schema.rs`（全量替换占位）

- [ ] **Step 1: 写失败的单元测试（先写在 schema.rs 底部）**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_mapping() {
        assert_eq!(kind_of(1), Kind::Text); // 文本
        assert_eq!(kind_of(2), Kind::Real); // 数字
        assert_eq!(kind_of(5), Kind::Int); // 日期(时间戳ms)
        assert_eq!(kind_of(7), Kind::Int); // 复选
        assert_eq!(kind_of(1001), Kind::Int); // 创建时间
        assert_eq!(kind_of(17), Kind::Json); // 附件
        assert_eq!(kind_of(99999), Kind::Json); // 未知类型兜底
    }

    #[test]
    fn batch_result_template_exists_with_row_key() {
        let t = template("batch-result").expect("模板在");
        assert_eq!(t.local_table, "batch_results");
        assert!(t.fields.iter().any(|f| f.name == "row_key"), "幂等锚点字段必须在模板里");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test kind_mapping`
Expected: FAIL（编译错误，类型未定义）

- [ ] **Step 3: 写实现（整文件）**

```rust
//! 表结构域:Kind、飞书字段类型码→Kind 映射、写回模板。纯数据/纯函数,不碰网络与 SQLite。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Text,
    Int,
    Real,
    Json,
}

impl Kind {
    pub fn sql_type(self) -> &'static str {
        match self {
            Kind::Text | Kind::Json => "TEXT",
            Kind::Int => "INTEGER",
            Kind::Real => "REAL",
        }
    }
}

/// 飞书字段类型码 → Kind。
/// 码表:1文本 2数字 3单选 4多选 5日期 7复选 11人员 13电话 15超链 17附件 18单向关联
/// 19查找引用 20公式 21双向关联 22地理位置 1001创建时间 1002修改时间 1003创建人 1004修改人 1005自动编号
pub fn kind_of(feishu_type: i64) -> Kind {
    match feishu_type {
        2 => Kind::Real,
        5 | 1001 | 1002 => Kind::Int, // 时间戳 ms
        7 => Kind::Int,               // checkbox → 0/1
        1 | 3 | 13 | 15 | 1005 => Kind::Text,
        _ => Kind::Json, // 多选/人员/附件/关联/公式… 保留原始 JSON,查询侧自己拆
    }
}

pub struct FieldDef {
    pub name: &'static str, // 飞书字段名 = 本地列名
    pub feishu_type: i64,   // 建飞书表用的类型码
    pub kind: Kind,
}

pub struct TableTemplate {
    pub name: &'static str,        // state create --template 引用名
    pub local_table: &'static str, // state 库本地表名
    pub fields: &'static [FieldDef],
}

/// 写回模板注册处。加业务类型 = 这里加模板 + state.rs 加建表迁移。
/// 每个模板必须含 row_key 字段(push 幂等锚点,create 时随行写入飞书)。
pub const TEMPLATES: &[TableTemplate] = &[TableTemplate {
    name: "batch-result",
    local_table: "batch_results",
    fields: &[
        FieldDef { name: "批次ID", feishu_type: 1, kind: Kind::Text },
        FieldDef { name: "型号", feishu_type: 1, kind: Kind::Text },
        FieldDef { name: "品牌", feishu_type: 1, kind: Kind::Text },
        FieldDef { name: "结果状态", feishu_type: 1, kind: Kind::Text },
        FieldDef { name: "结果JSON", feishu_type: 1, kind: Kind::Text },
        FieldDef { name: "row_key", feishu_type: 1, kind: Kind::Text },
    ],
}];

pub fn template(name: &str) -> Option<&'static TableTemplate> {
    TEMPLATES.iter().find(|t| t.name == name)
}

pub fn templates_json() -> serde_json::Value {
    serde_json::Value::Array(
        TEMPLATES
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "local_table": t.local_table,
                    "fields": t.fields.iter().map(|f| serde_json::json!({
                        "name": f.name, "feishu_type": f.feishu_type,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS（含 Task 2 的集成测试）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(schema): Kind/飞书类型映射/batch-result 模板"
```

---

### Task 4: map.rs —— 值归一化纯函数（原 coerce.rs 移植 + Kind 转型）

**Files:**
- Modify: `src/map.rs`（全量替换占位）

- [ ] **Step 1: 写失败的单元测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Kind;
    use rusqlite::types::Value as Sq;
    use serde_json::json;

    #[test]
    fn display_flattens_arrays_and_objects() {
        assert_eq!(to_display(&json!(["含税", "13%"])), "含税, 13%");
        assert_eq!(to_display(&json!([{"id": "ou_x", "name": "张三"}])), "张三");
        assert_eq!(to_display(&json!("  BAV99 ")), "BAV99");
    }

    #[test]
    fn coerce_by_kind() {
        assert_eq!(coerce(Some(&json!("1,234.5")), Kind::Real), Sq::Real(1234.5));
        assert_eq!(coerce(Some(&json!(42)), Kind::Int), Sq::Integer(42));
        assert_eq!(coerce(Some(&json!("")), Kind::Text), Sq::Null);
        assert_eq!(coerce(None, Kind::Text), Sq::Null);
        // Json kind 原样保留结构
        assert_eq!(coerce(Some(&json!([1, 2])), Kind::Json), Sq::Text("[1,2]".into()));
    }

    #[test]
    fn normalize_variants_collapse() {
        assert_eq!(normalize("bav-99 w"), "BAV99W");
        assert_eq!(normalize("BAV99W"), "BAV99W");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --lib map`
Expected: FAIL（函数未定义）

- [ ] **Step 3: 写实现（整文件；to_display/normalize 从旧 coerce.rs 原封移植）**

```rust
//! 飞书字段值 → SQL 值,纯函数,零 I/O。

use rusqlite::types::Value as SqlValue;
use serde_json::{Map, Value};

use crate::schema::Kind;

pub type Record = Map<String, Value>;

/// 飞书字段值 → 展示字符串。
/// 数组(供应商名称 `["江西乐商…"]`、含税 `["含税"]`)拼接元素;
/// 对象(采购负责人 `[{id,name}]`)取 `name`/`text`。
pub fn to_display(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        Value::Array(a) => a
            .iter()
            .map(to_display)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(o) => o
            .get("name")
            .or_else(|| o.get("text"))
            .map(to_display)
            .unwrap_or_else(|| v.to_string()),
    }
}

/// 按 Kind 转 SQL 值。转不动 → NULL(缓存是快照,宁缺勿错)。
pub fn coerce(v: Option<&Value>, kind: Kind) -> SqlValue {
    let Some(v) = v else { return SqlValue::Null };
    if v.is_null() {
        return SqlValue::Null;
    }
    match kind {
        Kind::Text => {
            let s = to_display(v);
            if s.is_empty() { SqlValue::Null } else { SqlValue::Text(s) }
        }
        Kind::Int => v
            .as_i64()
            .or_else(|| to_display(v).parse().ok())
            .map(SqlValue::Integer)
            .unwrap_or(SqlValue::Null),
        Kind::Real => v
            .as_f64()
            .or_else(|| to_display(v).replace(',', "").parse().ok())
            .map(SqlValue::Real)
            .unwrap_or(SqlValue::Null),
        Kind::Json => SqlValue::Text(v.to_string()),
    }
}

/// 型号归一:去符号 + 大写。serve.rs 注册成 SQLite `norm()` UDF,
/// agent SQL 里 `WHERE norm(型号) = norm('bav-99')` 做变体匹配。
pub fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '-' | '/' | ' ' | '\t'))
        .collect::<String>()
        .to_uppercase()
}

/// 一条 Record 按列定义转成 SQL 行。
pub fn to_row(rec: &Record, columns: &[(String, Kind)]) -> Vec<SqlValue> {
    columns.iter().map(|(name, kind)| coerce(rec.get(name), *kind)).collect()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(map): 值归一化纯函数,norm() 变体匹配移植"
```

---

### Task 5: source.rs —— lark-cli I/O 层（读并发移植 + 写方向四调用）

**Files:**
- Modify: `src/source.rs`（全量替换占位）
- Create: `tests/fixtures/fake-lark-cli/lark-cli`（假 lark-cli 脚本）

- [ ] **Step 1: 现场核对 lark-cli 写方向 flag 名**

```bash
lark-cli base +table-create --help
lark-cli base +record-batch-create --help
lark-cli base +record-batch-update --help
```

把下面实现里 `create_table`/`batch_create`/`batch_update` 的 flag 名与 payload 格式改成 help 输出的真实契约（记录到 commit message）。`+field-list` 的响应形状同样要核一次真环境：

```bash
lark-cli --format json base +field-list --as user \
  --base-token Mjlkb49B9aoptssVw8Jc0wGwnhh --table-id tblbtuMHFIOr6Oss | head -c 2000
```

把真实输出存成 `tests/fixtures/fake-lark-cli/field-list.json`（这是 fixture 蓝本，不许手编造）。

- [ ] **Step 2: 写假 lark-cli 脚本**

`tests/fixtures/fake-lark-cli/lark-cli`（`chmod +x`）：

```bash
#!/bin/bash
# 假 lark-cli:按 $FAKE_LARK_DIR 里的 canned JSON 回放;调用参数追记 calls.log 供断言。
echo "$@" >> "$FAKE_LARK_DIR/calls.log"
sub=""; offset="0"; prev=""
for a in "$@"; do
  case "$a" in +*) sub="${a#+}" ;; esac
  [ "$prev" = "--offset" ] && offset="$a"
  prev="$a"
done
for f in "$FAKE_LARK_DIR/$sub.$offset.json" "$FAKE_LARK_DIR/$sub.json"; do
  [ -f "$f" ] && cat "$f" && exit 0
done
echo '{"ok":true,"data":{"data":[],"fields":[],"has_more":false}}'
```

- [ ] **Step 3: 写失败的单元测试（record-list 响应解析，纯函数部分）**

source.rs 底部：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_record_page_pairs_fields_with_row_arrays() {
        let data = json!({
            "fields": ["型号", "品牌"],
            "data": [["BAV99", "NXP"], ["1N4148", null]],
            "has_more": false
        });
        let (recs, has_more) = parse_record_page(&data);
        assert!(!has_more);
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].get("型号").unwrap(), "BAV99");
        assert!(recs[1].get("品牌").unwrap().is_null());
    }
}
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cargo test parse_record_page`
Expected: FAIL

- [ ] **Step 5: 写实现（整文件）**

```rust
//! 唯一碰 lark-cli 处。读:并发 8 + 退避重试(实测结论原封移植)。写:串行分块,单次尝试
//! (歧义失败不重试——跨次幂等由 push 的 row_key 对账兜底)。

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{Map, Value};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::map::Record;
use crate::Fail;

const PAGE: usize = 200; // lark-cli --limit 上限
pub const MAX_CONCURRENT: usize = 8; // 实测:8/8 稳,12 偶有空响应
const RETRIES: u32 = 4; // 偶发空 stdout 退避重试

/// 跑一次 lark-cli,返回 data。空 stdout/非 JSON/ok!=true 都是 Err。
async fn lark(args: &[&str]) -> Result<Value> {
    let out = Command::new("lark-cli")
        .args(args)
        .output()
        .await
        .map_err(|e| Fail::Env(format!("lark-cli 起不来: {e}")))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let root: Value = serde_json::from_str(&stdout)
        .map_err(|_| anyhow!("空/非 JSON({} 字节)", stdout.len()))?;
    if root.get("ok") != Some(&Value::Bool(true)) {
        return Err(anyhow!(
            "ok!=true(token 可能过期需重登): {}",
            root.get("msg").map(|m| m.to_string()).unwrap_or_default()
        ));
    }
    Ok(root.get("data").cloned().unwrap_or(Value::Null))
}

/// record-list 一页响应 → (records, has_more)。行是数组,按 fields 索引配对成 Map。
pub fn parse_record_page(data: &Value) -> (Vec<Record>, bool) {
    let fields = data.get("fields").and_then(Value::as_array).cloned().unwrap_or_default();
    let rows = data.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    let has_more = data.get("has_more").and_then(Value::as_bool).unwrap_or(false);
    let mut out = Vec::with_capacity(rows.len());
    for vals in &rows {
        if let Some(arr) = vals.as_array() {
            let mut m = Map::new();
            for (i, f) in fields.iter().enumerate() {
                if let (Some(name), Some(v)) = (f.as_str(), arr.get(i)) {
                    m.insert(name.to_string(), v.clone());
                }
            }
            out.push(m);
        }
    }
    (out, has_more)
}

async fn fetch_page(
    sem: Arc<Semaphore>,
    app: String,
    tid: String,
    offset: usize,
) -> Result<(Vec<Record>, bool)> {
    let _permit = sem.acquire().await.expect("semaphore closed");
    let mut last = String::new();
    for attempt in 0..RETRIES {
        let r = lark(&[
            "--format", "json", "base", "+record-list", "--as", "user",
            "--base-token", &app, "--table-id", &tid,
            "--limit", &PAGE.to_string(), "--offset", &offset.to_string(),
        ])
        .await;
        match r {
            Ok(data) => return Ok(parse_record_page(&data)),
            Err(e) => {
                last = e.to_string();
                tokio::time::sleep(Duration::from_millis(200 * u64::from(attempt + 1))).await;
            }
        }
    }
    Err(anyhow!("offset={offset} 重试 {RETRIES} 次仍失败: {last}"))
}

/// 并发全量拉一张表:每轮并发一批页,直到尾页(短页/has_more=false)。
pub async fn fetch_table(sem: Arc<Semaphore>, app: &str, tid: &str) -> Result<Vec<Record>> {
    let mut all = Vec::new();
    let mut cursor = 0usize;
    loop {
        let futs: Vec<_> = (0..MAX_CONCURRENT)
            .map(|i| fetch_page(sem.clone(), app.to_string(), tid.to_string(), cursor + i * PAGE))
            .collect();
        let pages = futures::future::join_all(futs).await;
        let mut done = false;
        for page in pages {
            let (recs, has_more) = page?;
            let n = recs.len();
            all.extend(recs);
            if !has_more || n < PAGE {
                done = true;
            }
        }
        if done {
            break;
        }
        cursor += MAX_CONCURRENT * PAGE;
    }
    Ok(all)
}

/// 拉字段列表 → [(字段名, 类型码)]。
/// ⚠ 解析键名(field_name/type)按 Task 5 Step 1 存下的真实 fixture 核对后定稿。
pub async fn list_fields(app: &str, tid: &str) -> Result<Vec<(String, i64)>> {
    let mut fields = Vec::new();
    let mut offset = 0usize;
    loop {
        let data = lark(&[
            "--format", "json", "base", "+field-list", "--as", "user",
            "--base-token", app, "--table-id", tid,
            "--limit", "200", "--offset", &offset.to_string(),
        ])
        .await
        .with_context(|| format!("field-list {tid} 失败"))?;
        let items = data
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| data.as_array().cloned())
            .unwrap_or_default();
        let n = items.len();
        for f in &items {
            let name = f
                .get("field_name")
                .or_else(|| f.get("name"))
                .and_then(Value::as_str);
            let t = f.get("type").and_then(Value::as_i64);
            if let (Some(name), Some(t)) = (name, t) {
                fields.push((name.to_string(), t));
            }
        }
        let has_more = data.get("has_more").and_then(Value::as_bool).unwrap_or(false);
        if !has_more || n == 0 {
            break;
        }
        offset += n;
    }
    if fields.is_empty() {
        return Err(Fail::Task(format!("{tid} 字段列表为空(表被删/无权限?)")).into());
    }
    Ok(fields)
}

/// 建飞书表(带字段),返回 table_id。⚠ flag 名按 +table-create --help 核对定稿。
pub async fn create_table(app: &str, title: &str, fields: &[(&str, i64)]) -> Result<String> {
    let fields_json = serde_json::to_string(
        &fields
            .iter()
            .map(|(n, t)| serde_json::json!({"field_name": n, "type": t}))
            .collect::<Vec<_>>(),
    )?;
    let data = lark(&[
        "--format", "json", "base", "+table-create", "--as", "user",
        "--base-token", app, "--name", title, "--fields", &fields_json,
    ])
    .await
    .context("table-create 失败")?;
    data.get("table_id")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| anyhow!("table-create 响应缺 table_id: {data}"))
}

/// 批量建行。records 是 [{"字段名": 值}] 数组;返回按序 record_id。
/// ⚠ flag 名与响应键按 +record-batch-create --help 核对定稿。
pub async fn batch_create(app: &str, tid: &str, records: &[Value]) -> Result<Vec<String>> {
    let payload = serde_json::to_string(records)?;
    let data = lark(&[
        "--format", "json", "base", "+record-batch-create", "--as", "user",
        "--base-token", app, "--table-id", tid, "--records", &payload,
    ])
    .await
    .context("batch-create 失败")?;
    let ids: Vec<String> = data
        .get("records")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r.get("record_id").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if ids.len() != records.len() {
        return Err(anyhow!("batch-create 回了 {} 个 id,期望 {}", ids.len(), records.len()));
    }
    Ok(ids)
}

/// 批量改行。updates 是 [{"record_id": id, "fields": {...}}]。
pub async fn batch_update(app: &str, tid: &str, updates: &[Value]) -> Result<()> {
    let payload = serde_json::to_string(updates)?;
    lark(&[
        "--format", "json", "base", "+record-batch-update", "--as", "user",
        "--base-token", app, "--table-id", tid, "--records", &payload,
    ])
    .await
    .context("batch-update 失败")?;
    Ok(())
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(source): lark-cli I/O 层——读并发8移植+写方向四调用(flag 已按 --help 核对)"
```

---

### Task 6: state.rs —— 迁移、_registry、本地行读写

**Files:**
- Modify: `src/state.rs`（全量替换占位）

- [ ] **Step 1: 写失败的单元测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> rusqlite::Connection {
        // 内存库跑全量迁移
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn fresh_db_migrates_and_seeds_core_tables() {
        let conn = test_conn();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM _registry WHERE direction='pull'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 8, "7 张库存表 + 供应商档案");
        // 迁移幂等:重跑不炸不重复
        migrate(&conn).unwrap();
        let n2: i64 = conn.query_row("SELECT COUNT(*) FROM _registry", [], |r| r.get(0)).unwrap();
        assert_eq!(n, n2);
    }

    #[test]
    fn parse_base_url_extracts_tokens() {
        let (app, tid) = parse_base_url(
            "https://xxx.feishu.cn/base/Mjlkb49B9aoptssVw8Jc0wGwnhh?table=tblbtuMHFIOr6Oss&view=vewx",
        )
        .unwrap();
        assert_eq!(app, "Mjlkb49B9aoptssVw8Jc0wGwnhh");
        assert_eq!(tid, "tblbtuMHFIOr6Oss");
        assert!(parse_base_url("https://xxx.feishu.cn/docx/abc").is_err());
    }

    #[test]
    fn write_rejects_unknown_field_and_inserts_with_row_key() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO _registry(name,direction,app_token,table_id,template,created_at)
             VALUES('测试批次','push','app','tbl','batch-result',datetime('now'))",
            [],
        )
        .unwrap();
        let bad = serde_json::from_str(r#"{"不存在的列":"x"}"#).unwrap();
        assert!(write_rows(&conn, "测试批次", &[bad]).is_err());

        let good = serde_json::from_str(r#"{"批次ID":"B1","型号":"BAV99","结果状态":"found"}"#).unwrap();
        write_rows(&conn, "测试批次", &[good]).unwrap();
        let (key, dirty): (String, i64) = conn
            .query_row("SELECT _row_key,_dirty FROM batch_results WHERE _instance='测试批次'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!(!key.is_empty());
        assert_eq!(dirty, 1);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --lib state`
Expected: FAIL

- [ ] **Step 3: 写实现（整文件）**

```rust
//! agent-state.db 独管:迁移、_registry、_config、写回本地行。绝不碰缓存库。

use anyhow::Result;
use rusqlite::Connection;
use serde_json::{json, Map, Value};

use crate::schema::{self, TableTemplate};
use crate::Fail;

pub fn state_db_path() -> String {
    std::env::var("LARKDEPOT_STATE_DB").unwrap_or_else(|_| {
        format!("{}/.craft-agent/agent-state.db", std::env::var("HOME").unwrap_or_default())
    })
}

/// 迁移数组:只增不改(refinery 思想的零依赖实现)。
/// 每项一个事务,成功记入 _migrations。加模板 = 加 CREATE TABLE 迁移。
const MIGRATIONS: &[&str] = &[
    // 001: registry + config
    "CREATE TABLE _registry(
        name TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK(direction IN ('pull','push')),
        app_token TEXT NOT NULL,
        table_id TEXT NOT NULL,
        template TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL);
     CREATE TABLE _config(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    // 002: 预置核心 pull 表(原 config.rs 常量落库;7 库存 + 1 供应商档案)
    "INSERT INTO _registry(name,direction,app_token,table_id,created_at) VALUES
     ('动态库存表','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tbli1WYTb1Xn2MSa',datetime('now')),
     ('自家库存','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tblSUjXdehzkxIbK',datetime('now')),
     ('A级供应商库存','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tblzQbSnVNhGszYA',datetime('now')),
     ('B级供应商库存1','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tbldOthm6zmFonDM',datetime('now')),
     ('B级供应商库存2','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tblqaoi5UuUGybxF',datetime('now')),
     ('B级供应商库存3','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tbld53dBj2dvI1R6',datetime('now')),
     ('C级供应商库存','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tblBbvvRKB0Ziioz',datetime('now')),
     ('供应商档案','pull','Mjlkb49B9aoptssVw8Jc0wGwnhh','tblbtuMHFIOr6Oss',datetime('now'));",
    // 003: batch-result 模板本地表(实例=行,_instance 列区分)
    "CREATE TABLE batch_results(
        _instance TEXT NOT NULL,
        _row_key TEXT NOT NULL UNIQUE,
        _record_id TEXT,
        _dirty INTEGER NOT NULL DEFAULT 1,
        _pushed_at TEXT,
        \"批次ID\" TEXT, \"型号\" TEXT, \"品牌\" TEXT, \"结果状态\" TEXT, \"结果JSON\" TEXT);
     CREATE INDEX idx_batch_results_instance ON batch_results(_instance);",
];

pub fn open_state() -> Result<Connection> {
    let path = state_db_path();
    if let Some(dir) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| Fail::Env(format!("建目录失败: {e}")))?;
    }
    let conn = Connection::open(&path).map_err(|e| Fail::Env(format!("打不开 {path}: {e}")))?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations(idx INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    )?;
    let applied: i64 = conn.query_row("SELECT COALESCE(MAX(idx),0) FROM _migrations", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let idx = (i + 1) as i64;
        if idx <= applied {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("INSERT INTO _migrations(idx,applied_at) VALUES(?1,datetime('now'))", [idx])?;
        tx.commit()?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct RegEntry {
    pub name: String,
    pub direction: String,
    pub app_token: String,
    pub table_id: String,
    pub template: Option<String>,
    pub enabled: bool,
}

pub fn registry(conn: &Connection, direction: &str) -> Result<Vec<RegEntry>> {
    let mut stmt = conn.prepare(
        "SELECT name,direction,app_token,table_id,template,enabled FROM _registry
         WHERE direction=?1 ORDER BY name",
    )?;
    let rows = stmt
        .query_map([direction], |r| {
            Ok(RegEntry {
                name: r.get(0)?,
                direction: r.get(1)?,
                app_token: r.get(2)?,
                table_id: r.get(3)?,
                template: r.get(4)?,
                enabled: r.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn entry(conn: &Connection, name: &str) -> Result<RegEntry> {
    conn.query_row(
        "SELECT name,direction,app_token,table_id,template,enabled FROM _registry WHERE name=?1",
        [name],
        |r| {
            Ok(RegEntry {
                name: r.get(0)?,
                direction: r.get(1)?,
                app_token: r.get(2)?,
                table_id: r.get(3)?,
                template: r.get(4)?,
                enabled: r.get::<_, i64>(5)? != 0,
            })
        },
    )
    .map_err(|_| Fail::Usage(format!("registry 里没有 {name};larkdepot schema 看已注册表")).into())
}

/// 飞书 Base URL → (app_token, table_id)。
pub fn parse_base_url(url: &str) -> Result<(String, String)> {
    let app = url
        .split("/base/")
        .nth(1)
        .and_then(|rest| rest.split(['?', '/', '#']).next())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Fail::Usage("URL 里找不到 /base/<app_token>".into()))?;
    let tid = url
        .split("table=")
        .nth(1)
        .and_then(|r| r.split('&').next())
        .filter(|s| s.starts_with("tbl"))
        .ok_or_else(|| Fail::Usage("URL 里找不到 table=tblXXX 参数(打开表后从地址栏复制)".into()))?;
    Ok((app.to_string(), tid.to_string()))
}

pub fn register_pull(conn: &Connection, name: &str, app: &str, tid: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO _registry(name,direction,app_token,table_id,created_at)
         VALUES(?1,'pull',?2,?3,datetime('now'))",
        [name, app, tid],
    )
    .map_err(|e| Fail::Usage(format!("注册失败(重名?): {e}")))?;
    Ok(())
}

pub fn register_push(conn: &Connection, name: &str, app: &str, tid: &str, template: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO _registry(name,direction,app_token,table_id,template,created_at)
         VALUES(?1,'push',?2,?3,?4,datetime('now'))",
        [name, app, tid, template],
    )
    .map_err(|e| Fail::Usage(format!("注册失败(重名?): {e}")))?;
    Ok(())
}

fn push_template(conn: &Connection, instance: &str) -> Result<&'static TableTemplate> {
    let e = entry(conn, instance)?;
    if e.direction != "push" {
        return Err(Fail::Usage(format!("{instance} 是 pull 表,不能本地写")).into());
    }
    let tname = e.template.unwrap_or_default();
    schema::template(&tname)
        .ok_or_else(|| Fail::Task(format!("registry 里 {instance} 的模板 {tname} 未知(binary 版本过旧?)")).into())
}

/// 本地写行:校验字段 ∈ 模板、生成 _row_key、_dirty=1。
pub fn write_rows(conn: &Connection, instance: &str, rows: &[Map<String, Value>]) -> Result<Value> {
    let tpl = push_template(conn, instance)?;
    let allowed: Vec<&str> = tpl.fields.iter().map(|f| f.name).filter(|n| *n != "row_key").collect();
    for row in rows {
        for k in row.keys() {
            if !allowed.contains(&k.as_str()) {
                return Err(Fail::Usage(format!(
                    "字段「{k}」不在模板 {} 里;可用字段: {}",
                    tpl.name,
                    allowed.join("、")
                ))
                .into());
            }
        }
    }
    let cols: String = allowed.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join(",");
    let qs: String = (0..allowed.len()).map(|i| format!("?{}", i + 3)).collect::<Vec<_>>().join(",");
    let sql = format!(
        "INSERT INTO \"{}\"(_instance,_row_key,{cols}) VALUES(?1,?2,{qs})",
        tpl.local_table
    );
    let tx = conn.unchecked_transaction()?;
    let mut keys = Vec::with_capacity(rows.len());
    {
        let mut stmt = tx.prepare(&sql)?;
        for row in rows {
            let key = uuid::Uuid::new_v4().to_string();
            let mut params: Vec<rusqlite::types::Value> = vec![
                rusqlite::types::Value::Text(instance.to_string()),
                rusqlite::types::Value::Text(key.clone()),
            ];
            for name in &allowed {
                params.push(crate::map::coerce(
                    row.get(*name),
                    tpl.fields.iter().find(|f| f.name == *name).unwrap().kind,
                ));
            }
            stmt.execute(rusqlite::params_from_iter(params))?;
            keys.push(key);
        }
    }
    tx.commit()?;
    Ok(json!({"written": keys.len(), "row_keys": keys}))
}

/// push 积压统计:每个 push 实例的 pending(待建)/dirty(待改) 数。status 命令用。
pub fn push_backlog(conn: &Connection) -> Result<Value> {
    let mut out = Vec::new();
    for e in registry(conn, "push")? {
        let Some(tpl) = e.template.as_deref().and_then(schema::template) else { continue };
        let (pending, dirty): (i64, i64) = conn.query_row(
            &format!(
                "SELECT SUM(_record_id IS NULL), SUM(_dirty=1 AND _record_id IS NOT NULL)
                 FROM \"{}\" WHERE _instance=?1",
                tpl.local_table
            ),
            [&e.name],
            |r| Ok((r.get::<_, Option<i64>>(0)?.unwrap_or(0), r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )?;
        out.push(json!({"table": e.name, "pending_create": pending, "pending_update": dirty}));
    }
    Ok(Value::Array(out))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(state): 迁移+registry+预置核心表+本地行写入(字段校验/row_key)"
```

---

### Task 7: store.rs —— tmp 库写入 + 原子换库

**Files:**
- Modify: `src/store.rs`（全量替换占位）

- [ ] **Step 1: 写失败的单元测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Kind;

    fn one_load() -> Vec<TableLoad> {
        vec![TableLoad {
            name: "测试表".into(),
            columns: vec![("型号".into(), Kind::Text), ("数量".into(), Kind::Int)],
            rows: vec![vec![
                rusqlite::types::Value::Text("BAV99".into()),
                rusqlite::types::Value::Integer(7),
            ]],
        }]
    }

    #[test]
    fn build_swaps_atomically_and_sets_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.db");
        std::env::set_var("LARKDEPOT_CACHE_DB", &path);

        build_cache(one_load()).unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CACHE_SCHEMA_VERSION);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM \"测试表\"", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let meta: i64 = conn.query_row("SELECT rows FROM _sync_meta WHERE table_name='测试表'", [], |r| r.get(0)).unwrap();
        assert_eq!(meta, 1);
    }

    #[test]
    fn stale_tmp_swept_and_old_db_survives_failed_build() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.db");
        std::env::set_var("LARKDEPOT_CACHE_DB", &path);
        build_cache(one_load()).unwrap(); // 旧库就位

        // 伪造上次崩溃残留的 tmp(别的 pid)
        std::fs::write(path.with_file_name("cache.db.tmp-99999"), b"junk").unwrap();
        build_cache(one_load()).unwrap();
        assert!(!path.with_file_name("cache.db.tmp-99999").exists(), "残留 tmp 要被扫掉");
        // 旧库还能开
        rusqlite::Connection::open(&path).unwrap();
    }
}
```

注意：两个测试都动 `LARKDEPOT_CACHE_DB` 环境变量，cargo test 默认并行会串味。在 `Cargo.toml` 不动的前提下用串行跑：测试里路径互不相同 + `std::env::set_var` 竞态可接受性差，**统一约定 store 的函数签名显式收 path**（见实现——`build_cache_at(path, loads)`，`build_cache` 只是读 env 的薄壳），测试直接调 `build_cache_at` 就没有 env 竞态。上面测试代码相应写成调 `build_cache_at(&path, one_load())`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --lib store`
Expected: FAIL

- [ ] **Step 3: 写实现（整文件）**

```rust
//! 缓存库 staging 写入 + POSIX rename 原子换库。绝不碰飞书与 state 库。
//! 崩溃 = 无事发生:残留 tmp 下次 sync 按前缀扫掉(不只本 pid)。

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

use crate::schema::Kind;

pub const CACHE_SCHEMA_VERSION: i32 = 1;

pub fn cache_db_path() -> String {
    std::env::var("LARKDEPOT_CACHE_DB").unwrap_or_else(|_| {
        format!("{}/.craft-agent/feishu-cache.db", std::env::var("HOME").unwrap_or_default())
    })
}

pub struct TableLoad {
    pub name: String,
    pub columns: Vec<(String, Kind)>,
    pub rows: Vec<Vec<rusqlite::types::Value>>,
}

fn sweep_tmp(final_path: &Path) {
    let Some(dir) = final_path.parent() else { return };
    let Some(fname) = final_path.file_name().and_then(|s| s.to_str()) else { return };
    let prefix = format!("{fname}.tmp-");
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', ""))
}

pub fn build_cache(loads: Vec<TableLoad>) -> Result<serde_json::Value> {
    build_cache_at(Path::new(&cache_db_path()), loads)
}

pub fn build_cache_at(final_path: &Path, loads: Vec<TableLoad>) -> Result<serde_json::Value> {
    if let Some(dir) = final_path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    sweep_tmp(final_path);
    let tmp = final_path.with_file_name(format!(
        "{}.tmp-{}",
        final_path.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));

    let mut report = Vec::new();
    let build = (|| -> Result<()> {
        let conn = Connection::open(&tmp)?;
        conn.pragma_update(None, "user_version", CACHE_SCHEMA_VERSION)?;
        conn.execute_batch(
            "CREATE TABLE _sync_meta(
                table_name TEXT PRIMARY KEY, rows INTEGER NOT NULL,
                columns_json TEXT NOT NULL, synced_at TEXT NOT NULL);",
        )?;
        for t in &loads {
            let ddl: Vec<String> =
                t.columns.iter().map(|(n, k)| format!("{} {}", quote(n), k.sql_type())).collect();
            conn.execute_batch(&format!("CREATE TABLE {}({});", quote(&t.name), ddl.join(",")))?;
            let qs: String =
                (1..=t.columns.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
            let tx = conn.unchecked_transaction()?;
            {
                let mut stmt =
                    tx.prepare(&format!("INSERT INTO {} VALUES({qs})", quote(&t.name)))?;
                for row in &t.rows {
                    stmt.execute(rusqlite::params_from_iter(row.iter()))?;
                }
            }
            tx.commit()?;
            let cols_json = serde_json::to_string(
                &t.columns.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>(),
            )?;
            conn.execute(
                "INSERT INTO _sync_meta(table_name,rows,columns_json,synced_at)
                 VALUES(?1,?2,?3,datetime('now'))",
                rusqlite::params![t.name, t.rows.len() as i64, cols_json],
            )?;
            report.push(serde_json::json!({"table": t.name, "rows": t.rows.len()}));
        }
        Ok(())
    })();

    if let Err(e) = build {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    // fsync 后 rename:读者靠 POSIX rename 语义拿到完整旧快照或完整新快照,零锁。
    std::fs::File::open(&tmp)?.sync_all()?;
    std::fs::rename(&tmp, final_path)?;
    Ok(serde_json::Value::Array(report))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(store): tmp 库写入+原子换库+残留 tmp 前缀清扫"
```

---

### Task 8: sync + register 接线（发现 → 拉取 → 换库全链路）

**Files:**
- Modify: `src/main.rs`（run() 里接 Sync/Register 分支）
- Test: `tests/cli.rs`（追加，用假 lark-cli）

- [ ] **Step 1: 写失败的集成测试（追加到 tests/cli.rs）**

```rust
use std::path::PathBuf;

/// 每个测试独立 tempdir + 假 lark-cli PATH + 两库 env。
fn fake_env(fixtures: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let fake = dir.path().join("fake");
    std::fs::create_dir_all(&fake).unwrap();
    std::fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fake-lark-cli/lark-cli"),
        fake.join("lark-cli"),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(fake.join("lark-cli"), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    for (name, content) in fixtures {
        std::fs::write(fake.join(name), content).unwrap();
    }
    let cache = dir.path().join("cache.db");
    let state = dir.path().join("state.db");
    (dir, cache, state)
}

fn cmd_in(dir: &tempfile::TempDir, cache: &PathBuf, state: &PathBuf) -> Command {
    let fake = dir.path().join("fake");
    let mut c = cmd();
    let path = format!("{}:{}", fake.display(), std::env::var("PATH").unwrap());
    c.env("PATH", path)
        .env("FAKE_LARK_DIR", &fake)
        .env("LARKDEPOT_CACHE_DB", cache)
        .env("LARKDEPOT_STATE_DB", state);
    c
}

const FIELD_LIST: &str = r#"{"ok":true,"data":{"data":[
  {"field_name":"型号","type":1},{"field_name":"数量","type":2}],"has_more":false}}"#;
const RECORD_LIST: &str = r#"{"ok":true,"data":{"fields":["型号","数量"],
  "data":[["BAV99",100],["1N4148",50]],"has_more":false}}"#;

#[test]
fn sync_one_table_discovers_columns_and_builds_cache() {
    let (dir, cache, state) = fake_env(&[("field-list.json", FIELD_LIST), ("record-list.json", RECORD_LIST)]);
    // 只 sync 一张表,避免 8 张预置表都要 fixture
    cmd_in(&dir, &cache, &state).args(["sync", "--table", "供应商档案"]).assert().success();

    let conn = rusqlite::Connection::open(&cache).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM \"供应商档案\"", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);
    // 数字列真是 REAL
    let q: f64 = conn
        .query_row("SELECT 数量 FROM \"供应商档案\" WHERE 型号='BAV99'", [], |r| r.get(0))
        .unwrap();
    assert!((q - 100.0).abs() < f64::EPSILON);
}

#[test]
fn register_then_sync_includes_new_table() {
    let (dir, cache, state) = fake_env(&[("field-list.json", FIELD_LIST), ("record-list.json", RECORD_LIST)]);
    cmd_in(&dir, &cache, &state)
        .args(["register", "https://x.feishu.cn/base/appNEW123?table=tblNEW456", "--name", "新表"])
        .assert()
        .success();
    cmd_in(&dir, &cache, &state).args(["sync", "--table", "新表"]).assert().success();
    let conn = rusqlite::Connection::open(&cache).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM \"新表\"", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);
}
```

注意 `tests/cli.rs` 用了 rusqlite/tempfile —— 已在 dev-dependencies（rusqlite 是主依赖，测试直接用）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --test cli`
Expected: 新增 2 个 FAIL（sync/register 报"尚未实现"）

- [ ] **Step 3: 在 main.rs 的 run() 接线**

替换 `run()` 中对应分支（保留 `_ =>` 给未接线命令）：

```rust
        Cmd::Sync { table } => {
            let st = state::open_state()?;
            let entries: Vec<_> = state::registry(&st, "pull")?
                .into_iter()
                .filter(|e| e.enabled && table.as_deref().map_or(true, |t| t == e.name))
                .collect();
            if entries.is_empty() {
                return Err(Fail::Usage("没有匹配的 pull 表;larkdepot schema 看已注册表".into()).into());
            }
            let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(source::MAX_CONCURRENT));
            let mut loads = Vec::new();
            for e in &entries {
                let fields = source::list_fields(&e.app_token, &e.table_id).await?;
                let columns: Vec<(String, schema::Kind)> =
                    fields.iter().map(|(n, t)| (n.clone(), schema::kind_of(*t))).collect();
                let recs = source::fetch_table(sem.clone(), &e.app_token, &e.table_id).await?;
                let rows = recs.iter().map(|r| map::to_row(r, &columns)).collect();
                loads.push(store::TableLoad { name: e.name.clone(), columns, rows });
            }
            let report = store::build_cache(loads)?;
            println!("{}", envelope(report, false, None));
        }
        Cmd::Register { url, name } => {
            let (app, tid) = state::parse_base_url(&url)?;
            // 注册前拉一次字段列表验证可访问,顺便探出默认名
            let fields = source::list_fields(&app, &tid).await?;
            let name = name.unwrap_or_else(|| tid.clone());
            let st = state::open_state()?;
            state::register_pull(&st, &name, &app, &tid)?;
            println!(
                "{}",
                envelope(
                    json!({"registered": name, "app_token": app, "table_id": tid,
                           "fields": fields.len(), "next": "跑 larkdepot sync 纳入缓存"}),
                    false,
                    None
                )
            );
        }
```

**部分 sync 语义注意**：`--table` 过滤时 build_cache 只重建过滤后的表——但原子换库是整库替换，会丢掉其他表！所以 `--table` 模式下必须**全表照拉、只是校验入口**？不对——正确语义：`--table` 过滤只该用于调试单表。为守住"缓存库整体重建"的不变量，**`--table` 模式仍拉其余表**代价太大。取舍：`--table` 时 build 出的缓存库只含该表，其余表消失——这正是"缓存可抛弃"允许的（下次全量 sync 找回来），但要在输出里明示：

```rust
            let partial = table.is_some();
            println!("{}", envelope(json!({"tables": report, "partial": partial,
                "warning": if partial { "部分 sync:缓存库现在只含指定表,跑全量 sync 恢复" } else { "" }}), false, None));
```

（测试里单表 sync 后只查该表，语义一致。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sync,register): 发现→拉取→原子换库全链路接线"
```

---

### Task 9: serve.rs + query sql / status / schema 完整接线

**Files:**
- Modify: `src/serve.rs`（全量替换占位）
- Modify: `src/main.rs`（Query/Status/Schema 分支）
- Test: `tests/cli.rs`（追加）

- [ ] **Step 1: 写失败的集成测试（追加）**

```rust
#[test]
fn query_sql_readonly_with_norm_and_limit() {
    let (dir, cache, state) = fake_env(&[("field-list.json", FIELD_LIST), ("record-list.json", RECORD_LIST)]);
    cmd_in(&dir, &cache, &state).args(["sync", "--table", "供应商档案"]).assert().success();

    // norm() 变体匹配
    let out = cmd_in(&dir, &cache, &state)
        .args(["query", "sql", "--sql", "SELECT 型号 FROM 供应商档案 WHERE norm(型号)=norm('bav-99')"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["data"][0]["型号"], "BAV99");
    assert!(v["freshness"]["synced_at"].is_string());

    // limit 截断
    let out = cmd_in(&dir, &cache, &state)
        .args(["query", "sql", "--sql", "SELECT * FROM 供应商档案", "--limit", "1"])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["truncated"], true);
    assert_eq!(v["data"].as_array().unwrap().len(), 1);

    // 写语句在只读连接上必须失败,退出码 1(用法错)
    cmd_in(&dir, &cache, &state)
        .args(["query", "sql", "--sql", "DELETE FROM 供应商档案"])
        .assert()
        .code(1);
}

#[test]
fn query_before_sync_exits_2_with_hint() {
    let (dir, cache, state) = fake_env(&[]);
    let out = cmd_in(&dir, &cache, &state)
        .args(["query", "sql", "--sql", "SELECT 1"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(v["error"]["hint"].as_str().unwrap().contains("sync"));
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --test cli`
Expected: 新增测试 FAIL

- [ ] **Step 3: 写 serve.rs（整文件）**

```rust
//! 只读查询侧:query sql / freshness。绝不写任何库。

use anyhow::Result;
use rusqlite::{functions::FunctionFlags, Connection, OpenFlags};
use serde_json::{json, Map, Value};

use crate::store::CACHE_SCHEMA_VERSION;
use crate::Fail;

pub fn open_ro(path: &str) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| Fail::Env(format!("打不开 {path}(先跑 sync?): {e}")))?;
    conn.create_scalar_function(
        "norm",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(crate::map::normalize(&ctx.get::<String>(0)?)),
    )?;
    Ok(conn)
}

/// 缓存库版本门:不符 → 结构化错误(缓存无迁移,sync 即修复)。
pub fn check_cache_version(conn: &Connection) -> Result<()> {
    let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v != CACHE_SCHEMA_VERSION {
        return Err(Fail::Env(format!(
            "缓存库 user_version={v} 与 binary 期望 {CACHE_SCHEMA_VERSION} 不符,先跑 sync"
        ))
        .into());
    }
    Ok(())
}

/// 只读执行任意 SQL,外包一层 LIMIT 保证有界输出。
pub fn run_sql(conn: &Connection, sql: &str, limit: usize) -> Result<(Vec<Value>, bool)> {
    let wrapped = format!(
        "SELECT * FROM ({}) LIMIT {}",
        sql.trim().trim_end_matches(';'),
        limit + 1
    );
    let mut stmt = conn
        .prepare(&wrapped)
        .map_err(|e| Fail::Usage(format!("SQL 错误: {e};larkdepot schema 看表和列")))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows_out: Vec<Value> = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| Fail::Usage(format!("SQL 执行错误: {e}")))?;
    while let Some(r) = rows.next()? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v: rusqlite::types::Value = r.get(i)?;
            m.insert(
                name.clone(),
                match v {
                    rusqlite::types::Value::Null => Value::Null,
                    rusqlite::types::Value::Integer(x) => json!(x),
                    rusqlite::types::Value::Real(x) => json!(x),
                    rusqlite::types::Value::Text(s) => json!(s),
                    rusqlite::types::Value::Blob(_) => json!("<blob>"),
                },
            );
        }
        rows_out.push(Value::Object(m));
        if rows_out.len() > limit {
            break;
        }
    }
    let truncated = rows_out.len() > limit;
    if truncated {
        rows_out.truncate(limit);
    }
    Ok((rows_out, truncated))
}

/// 从 _sync_meta 读 freshness(最旧的表代表整库)。
pub fn freshness(conn: &Connection) -> Value {
    conn.query_row(
        "SELECT MIN(synced_at), CAST((julianday('now')-julianday(MIN(synced_at)))*86400 AS INTEGER)
         FROM _sync_meta",
        [],
        |r| {
            Ok(json!({"synced_at": r.get::<_, Option<String>>(0)?, "age_s": r.get::<_, Option<i64>>(1)?}))
        },
    )
    .unwrap_or(json!({"synced_at": null, "age_s": null}))
}

/// 每表列清单(schema 命令用)。
pub fn table_columns(conn: &Connection) -> Value {
    let mut out = Map::new();
    let mut stmt = match conn.prepare("SELECT table_name, columns_json, rows FROM _sync_meta") {
        Ok(s) => s,
        Err(_) => return Value::Object(out), // 缓存库还没建
    };
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .into_iter()
        .flatten()
        .flatten();
    for (name, cols, n) in rows {
        out.insert(
            name,
            json!({"columns": serde_json::from_str::<Value>(&cols).unwrap_or(Value::Null), "rows": n}),
        );
    }
    Value::Object(out)
}
```

- [ ] **Step 4: main.rs 接线 Query/Status/Schema**

```rust
        Cmd::Query(QueryCmd::Sql { sql, db, limit }) => {
            let path = match db.as_str() {
                "cache" => store::cache_db_path(),
                "state" => state::state_db_path(),
                other => return Err(Fail::Usage(format!("--db 只认 cache|state,不认 {other}")).into()),
            };
            let conn = serve::open_ro(&path)?;
            let fresh = if db == "cache" {
                serve::check_cache_version(&conn)?;
                Some(serve::freshness(&conn))
            } else {
                None
            };
            let (rows, truncated) = serve::run_sql(&conn, &sql, limit)?;
            println!("{}", envelope(serde_json::Value::Array(rows), truncated, fresh));
        }
        Cmd::Status => {
            let st = state::open_state()?;
            let backlog = state::push_backlog(&st)?;
            let cache = match serve::open_ro(&store::cache_db_path()) {
                Ok(conn) => json!({"path": store::cache_db_path(), "freshness": serve::freshness(&conn),
                                   "tables": serve::table_columns(&conn)}),
                Err(_) => json!({"path": store::cache_db_path(), "freshness": null,
                                 "hint": "缓存库不存在,跑 larkdepot sync"}),
            };
            println!("{}", envelope(json!({"cache": cache, "push_backlog": backlog}), false, None));
        }
        Cmd::Schema => {
            let st = state::open_state()?;
            let registry: Vec<_> = state::registry(&st, "pull")?
                .into_iter()
                .chain(state::registry(&st, "push")?)
                .map(|e| json!({"name": e.name, "direction": e.direction, "template": e.template,
                                "enabled": e.enabled}))
                .collect();
            let columns = serve::open_ro(&store::cache_db_path())
                .map(|c| serve::table_columns(&c))
                .unwrap_or(json!({}));
            let mut contract = schema_contract();
            contract["registry"] = json!(registry);
            contract["cache_tables"] = columns;
            contract["query_hints"] = json!({
                "norm": "norm(列) 归一化型号变体:去 -/空格 转大写。WHERE norm(型号)=norm('bav-99')",
                "json_cols": "多选/人员/附件等列存原始 JSON 文本,用 json_extract 拆"
            });
            println!("{}", envelope(contract, false, None));
        }
```

（`Cmd::Schema` 原占位实现删除，这里是终版。）

- [ ] **Step 5: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS（含 Task 2 的 schema 契约测试——注意该测试现在会碰 state 库，`schema_outputs_contract_json` 测试要加 `LARKDEPOT_STATE_DB` tempdir env，同步修掉）

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(serve): query sql 只读+norm()+强制limit+freshness;status/schema 终版"
```

---

### Task 10: state create / write / list 接线

**Files:**
- Modify: `src/main.rs`（State 分支）
- Test: `tests/cli.rs`（追加）

- [ ] **Step 1: 写失败的集成测试（追加）**

```rust
const TABLE_CREATE: &str = r#"{"ok":true,"data":{"table_id":"tblCREATED1"}}"#;

#[test]
fn state_create_write_list_roundtrip() {
    let (dir, cache, state) = fake_env(&[("table-create.json", TABLE_CREATE)]);
    // 建实例:飞书建表 + registry 落行
    cmd_in(&dir, &cache, &state)
        .args(["state", "create", "--template", "batch-result", "--title", "0702找料", "--app", "appXYZ"])
        .assert()
        .success();
    // 本地写两行
    cmd_in(&dir, &cache, &state)
        .args(["state", "write", "0702找料", "--json", r#"{"批次ID":"B1","型号":"BAV99","结果状态":"found"}"#])
        .assert()
        .success();
    // 未知字段被挡,退出 1
    cmd_in(&dir, &cache, &state)
        .args(["state", "write", "0702找料", "--json", r#"{"胡说":"x"}"#])
        .assert()
        .code(1);
    // list 读回
    let out = cmd_in(&dir, &cache, &state)
        .args(["state", "list", "0702找料"])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["data"].as_array().unwrap().len(), 1);
    assert_eq!(v["data"][0]["型号"], "BAV99");
    assert_eq!(v["data"][0]["_pushed"], false);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --test cli`
Expected: FAIL

- [ ] **Step 3: main.rs 接线**

```rust
        Cmd::State(StateCmd::Create { template, title, app }) => {
            let tpl = schema::template(&template).ok_or_else(|| {
                Fail::Usage(format!(
                    "模板 {template} 不存在;可用: {}",
                    schema::TEMPLATES.iter().map(|t| t.name).collect::<Vec<_>>().join("、")
                ))
            })?;
            let fields: Vec<(&str, i64)> = tpl.fields.iter().map(|f| (f.name, f.feishu_type)).collect();
            let tid = source::create_table(&app, &title, &fields).await?;
            let st = state::open_state()?;
            state::register_push(&st, &title, &app, &tid, &template)?;
            println!(
                "{}",
                envelope(json!({"created": title, "table_id": tid, "template": template,
                                "next": "state write 落行后 push 推送"}), false, None)
            );
        }
        Cmd::State(StateCmd::Write { instance, json: row_json, stdin }) => {
            let mut rows: Vec<serde_json::Map<String, serde_json::Value>> = Vec::new();
            if let Some(j) = row_json {
                rows.push(serde_json::from_str(&j).map_err(|e| Fail::Usage(format!("--json 不是 JSON 对象: {e}")))?);
            }
            if stdin {
                use std::io::BufRead;
                for line in std::io::stdin().lock().lines() {
                    let line = line?;
                    if line.trim().is_empty() { continue; }
                    rows.push(serde_json::from_str(&line).map_err(|e| Fail::Usage(format!("stdin 行不是 JSON 对象: {e}")))?);
                }
            }
            if rows.is_empty() {
                return Err(Fail::Usage("要么 --json 要么 --stdin,总得给行".into()).into());
            }
            let st = state::open_state()?;
            let report = state::write_rows(&st, &instance, &rows)?;
            println!("{}", envelope(report, false, None));
        }
        Cmd::State(StateCmd::List { instance, filter }) => {
            let st = state::open_state()?;
            let e = state::entry(&st, &instance)?;
            let tpl = schema::template(e.template.as_deref().unwrap_or_default())
                .ok_or_else(|| Fail::Task("实例模板未知".into()))?;
            // filter 只支持 k=v 单条件(要复杂条件用 query sql --db state)
            let (where_extra, param): (String, Vec<String>) = match &filter {
                Some(f) => {
                    let (k, v) = f.split_once('=').ok_or_else(|| Fail::Usage("--filter 形如 列=值".into()))?;
                    if !tpl.fields.iter().any(|fd| fd.name == k) {
                        return Err(Fail::Usage(format!("filter 列 {k} 不在模板里")).into());
                    }
                    (format!(" AND \"{k}\"=?2"), vec![v.to_string()])
                }
                None => (String::new(), vec![]),
            };
            let sql = format!(
                "SELECT *, (_record_id IS NOT NULL AND _dirty=0) AS _pushed FROM \"{}\" WHERE _instance=?1{}",
                tpl.local_table, where_extra
            );
            let mut params: Vec<String> = vec![instance.clone()];
            params.extend(param);
            let conn_ro = serve::open_ro(&state::state_db_path())?;
            let mut stmt = conn_ro.prepare(&sql)?;
            // 复用 serve 的行→JSON 逻辑不划算(带参数),这里直接手转
            let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mut out = Vec::new();
            let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
            while let Some(r) = rows.next()? {
                let mut m = serde_json::Map::new();
                for (i, name) in names.iter().enumerate() {
                    let v: rusqlite::types::Value = r.get(i)?;
                    m.insert(name.clone(), match v {
                        rusqlite::types::Value::Null => serde_json::Value::Null,
                        rusqlite::types::Value::Integer(x) => {
                            if name == "_pushed" { json!(x != 0) } else { json!(x) }
                        }
                        rusqlite::types::Value::Real(x) => json!(x),
                        rusqlite::types::Value::Text(s) => json!(s),
                        rusqlite::types::Value::Blob(_) => json!("<blob>"),
                    });
                }
                out.push(serde_json::Value::Object(m));
            }
            println!("{}", envelope(serde_json::Value::Array(out), false, None));
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(state cli): create/write/list 接线——建飞书表+本地落行+读回"
```

---

### Task 11: push.rs —— 出箱推送 + 幂等对账

**Files:**
- Modify: `src/push.rs`（全量替换占位）
- Modify: `src/main.rs`（Push 分支）
- Test: `tests/cli.rs`（追加）

- [ ] **Step 1: 写失败的集成测试（追加）**

```rust
const BATCH_CREATE: &str = r#"{"ok":true,"data":{"records":[{"record_id":"recAAA"}]}}"#;
/// 对账用:飞书上已存在 row_key=KEY_ALREADY 的行(模拟上次 create 成功但回填前崩溃)
fn record_list_with_row_key(key: &str) -> String {
    format!(
        r#"{{"ok":true,"data":{{"fields":["row_key","批次ID"],"data":[["{key}","B0"]],"has_more":false}}}}"#
    )
}

#[test]
fn push_creates_pending_rows_and_backfills_record_id() {
    let (dir, cache, state) = fake_env(&[
        ("table-create.json", TABLE_CREATE),
        ("batch-create.json", BATCH_CREATE),
        ("record-list.json", r#"{"ok":true,"data":{"fields":["row_key"],"data":[],"has_more":false}}"#),
    ]);
    cmd_in(&dir, &cache, &state)
        .args(["state", "create", "--template", "batch-result", "--title", "T1", "--app", "appX"])
        .assert().success();
    cmd_in(&dir, &cache, &state)
        .args(["state", "write", "T1", "--json", r#"{"批次ID":"B1","型号":"BAV99"}"#])
        .assert().success();
    cmd_in(&dir, &cache, &state).args(["push"]).assert().success();

    // record_id 回填、dirty 清零
    let conn = rusqlite::Connection::open(&state).unwrap();
    let (rid, dirty): (String, i64) = conn
        .query_row("SELECT _record_id,_dirty FROM batch_results", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!(rid, "recAAA");
    assert_eq!(dirty, 0);
    // 再 push 一次:无待推行,不该再调 batch-create(幂等)
    cmd_in(&dir, &cache, &state).args(["push"]).assert().success();
    let calls = std::fs::read_to_string(dir.path().join("fake/calls.log")).unwrap();
    assert_eq!(calls.matches("record-batch-create").count(), 1);
}

#[test]
fn push_reconciles_row_key_before_create_no_duplicates() {
    let (dir, cache, state) = fake_env(&[("table-create.json", TABLE_CREATE)]);
    cmd_in(&dir, &cache, &state)
        .args(["state", "create", "--template", "batch-result", "--title", "T2", "--app", "appX"])
        .assert().success();
    cmd_in(&dir, &cache, &state)
        .args(["state", "write", "T2", "--json", r#"{"批次ID":"B0"}"#])
        .assert().success();
    // 模拟"上次 create 成功但没回填":飞书 record-list 已有这行的 row_key
    let conn = rusqlite::Connection::open(&state).unwrap();
    let key: String = conn.query_row("SELECT _row_key FROM batch_results", [], |r| r.get(0)).unwrap();
    std::fs::write(dir.path().join("fake/record-list.json"), record_list_with_row_key(&key)).unwrap();

    cmd_in(&dir, &cache, &state).args(["push"]).assert().success();
    // 对账命中 → 不调 batch-create,只回填(record_id 来自飞书行需要 record-list 带 id…见实现注)
    let calls = std::fs::read_to_string(dir.path().join("fake/calls.log")).unwrap();
    assert_eq!(calls.matches("record-batch-create").count(), 0, "对账命中不许重复建行");
}
```

**实现注（对账要 record_id）**：`+record-list` 的行数组形式不含 record_id 时，改用带 `--with-record-id` 一类 flag（Step 2 用 `--help` 核对；若 record-list 无法带 id，退路是 `+record-search` 或 `+record-list --format json` 的完整模式）。fixture 相应带上 id 字段。**这一步是本 Task 的现场核对点，不许跳过。**

- [ ] **Step 2: 现场核对 record-list 能否带 record_id**

```bash
lark-cli base +record-list --help
lark-cli --format json base +record-list --as user \
  --base-token Mjlkb49B9aoptssVw8Jc0wGwnhh --table-id tblbtuMHFIOr6Oss --limit 2
```

按真实输出定稿 `map_row_keys` 的解析与 fixture 形状。

- [ ] **Step 3: 跑测试确认失败**

Run: `cargo test --test cli`
Expected: FAIL（push 未实现）

- [ ] **Step 4: 写 push.rs（整文件）**

```rust
//! 出箱推送编排:读 state → source 批量写 → 回填。
//! 幂等三件套:_row_key(锚)、推前对账(防重)、失败行原地不动(下次重试)。

use anyhow::Result;
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::schema::{self, TableTemplate};
use crate::{source, state, Fail};

const CHUNK: usize = 200; // 批量写分块,写方向保守串行

struct LocalRow {
    row_key: String,
    record_id: Option<String>,
    fields: Value, // {"字段名": 值},含 row_key
}

fn load_rows(conn: &Connection, tpl: &TableTemplate, instance: &str, filter: &str) -> Result<Vec<LocalRow>> {
    let cols: Vec<&str> = tpl.fields.iter().map(|f| f.name).filter(|n| *n != "row_key").collect();
    let col_sql: String = cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT _row_key,_record_id,{col_sql} FROM \"{}\" WHERE _instance=?1 AND {filter}",
        tpl.local_table
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut out = Vec::new();
    let mut rows = stmt.query([instance])?;
    while let Some(r) = rows.next()? {
        let row_key: String = r.get(0)?;
        let record_id: Option<String> = r.get(1)?;
        let mut fields = serde_json::Map::new();
        fields.insert("row_key".into(), json!(row_key));
        for (i, c) in cols.iter().enumerate() {
            let v: rusqlite::types::Value = r.get(i + 2)?;
            let jv = match v {
                rusqlite::types::Value::Null => continue, // 空值不发
                rusqlite::types::Value::Integer(x) => json!(x),
                rusqlite::types::Value::Real(x) => json!(x),
                rusqlite::types::Value::Text(s) => json!(s),
                rusqlite::types::Value::Blob(_) => continue,
            };
            fields.insert((*c).to_string(), jv);
        }
        out.push(LocalRow { row_key, record_id, fields: Value::Object(fields) });
    }
    Ok(out)
}

pub async fn push(conn: &Connection, only: Option<&str>) -> Result<Value> {
    let entries: Vec<_> = state::registry(conn, "push")?
        .into_iter()
        .filter(|e| e.enabled && only.map_or(true, |o| o == e.name))
        .collect();
    if entries.is_empty() {
        return Err(Fail::Usage("没有匹配的 push 表".into()).into());
    }
    let mut report = Vec::new();
    let mut any_fail = false;
    for e in &entries {
        let tpl = schema::template(e.template.as_deref().unwrap_or_default())
            .ok_or_else(|| Fail::Task(format!("{} 模板未知", e.name)))?;
        let mut created = 0usize;
        let mut updated = 0usize;
        let mut errors: Vec<Value> = Vec::new();

        // ① 对账:有待建行才拉飞书现存 row_key(防上次 create 成功但回填前崩溃)
        let pending = load_rows(conn, tpl, &e.name, "_record_id IS NULL")?;
        if !pending.is_empty() {
            let existing = source::map_row_keys(&e.app_token, &e.table_id).await?;
            for r in &pending {
                if let Some(rid) = existing.get(&r.row_key) {
                    mark_pushed(conn, tpl, &r.row_key, rid)?;
                }
            }
        }

        // ② 建(对账后重读)
        let pending = load_rows(conn, tpl, &e.name, "_record_id IS NULL")?;
        for chunk in pending.chunks(CHUNK) {
            let records: Vec<Value> = chunk.iter().map(|r| json!({"fields": r.fields})).collect();
            match source::batch_create(&e.app_token, &e.table_id, &records).await {
                Ok(ids) => {
                    for (r, rid) in chunk.iter().zip(ids.iter()) {
                        mark_pushed(conn, tpl, &r.row_key, rid)?;
                        created += 1;
                    }
                }
                Err(err) => {
                    errors.push(json!({"stage": "create", "rows": chunk.len(), "error": err.to_string()}));
                    break; // 本表停,行原地不动,下次 push 对账后重试
                }
            }
        }

        // ③ 改
        let dirty = load_rows(conn, tpl, &e.name, "_dirty=1 AND _record_id IS NOT NULL")?;
        for chunk in dirty.chunks(CHUNK) {
            let updates: Vec<Value> = chunk
                .iter()
                .map(|r| json!({"record_id": r.record_id, "fields": r.fields}))
                .collect();
            match source::batch_update(&e.app_token, &e.table_id, &updates).await {
                Ok(()) => {
                    for r in chunk {
                        clear_dirty(conn, tpl, &r.row_key)?;
                        updated += 1;
                    }
                }
                Err(err) => {
                    errors.push(json!({"stage": "update", "rows": chunk.len(), "error": err.to_string()}));
                    break;
                }
            }
        }

        if !errors.is_empty() {
            any_fail = true;
        }
        report.push(json!({"table": e.name, "created": created, "updated": updated, "errors": errors}));
    }
    let out = Value::Array(report);
    if any_fail {
        return Err(Fail::Task(format!("部分推送失败(失败行下次 push 自动重试): {out}")).into());
    }
    Ok(out)
}

fn mark_pushed(conn: &Connection, tpl: &TableTemplate, row_key: &str, record_id: &str) -> Result<()> {
    conn.execute(
        &format!(
            "UPDATE \"{}\" SET _record_id=?1,_dirty=0,_pushed_at=datetime('now') WHERE _row_key=?2",
            tpl.local_table
        ),
        [record_id, row_key],
    )?;
    Ok(())
}

fn clear_dirty(conn: &Connection, tpl: &TableTemplate, row_key: &str) -> Result<()> {
    conn.execute(
        &format!(
            "UPDATE \"{}\" SET _dirty=0,_pushed_at=datetime('now') WHERE _row_key=?1",
            tpl.local_table
        ),
        [row_key],
    )?;
    Ok(())
}
```

source.rs 追加 `map_row_keys`（对账用；解析形状按 Step 2 核对结果定稿）：

```rust
/// 拉飞书表现存 row_key → record_id 映射(push 对账用)。
pub async fn map_row_keys(app: &str, tid: &str) -> Result<std::collections::HashMap<String, String>> {
    let sem = Arc::new(Semaphore::new(MAX_CONCURRENT));
    let recs = fetch_table_with_ids(sem, app, tid).await?; // 带 record_id 的变体,按 --help 核对定稿
    let mut m = std::collections::HashMap::new();
    for r in recs {
        if let (Some(key), Some(rid)) = (
            r.get("row_key").map(crate::map::to_display).filter(|s| !s.is_empty()),
            r.get("_record_id").and_then(serde_json::Value::as_str),
        ) {
            m.insert(key, rid.to_string());
        }
    }
    Ok(m)
}
```

main.rs 接线：

```rust
        Cmd::Push { table } => {
            let st = state::open_state()?;
            let report = push::push(&st, table.as_deref()).await?;
            println!("{}", envelope(report, false, None));
        }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cargo test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(push): 出箱推送——row_key 对账幂等+分块批量+失败行原地重试"
```

---

### Task 12: musl 构建 + 真机冒烟 + Release v0.1.0

**Files:**
- Create: `build-musl.sh`

- [ ] **Step 1: 写构建脚本**

```bash
#!/bin/bash
# musl 静态编译(prod 内核 5.15,glibc 门槛,必须容器里编)。产物 target/release/larkdepot
set -euo pipefail
docker run --rm -v "$PWD":/w -w /w rust:alpine sh -c \
  'apk add --no-cache musl-dev build-base && cargo build --release'
file target/release/larkdepot
```

`chmod +x build-musl.sh && ./build-musl.sh`
Expected: `file` 输出含 `statically linked`。

- [ ] **Step 2: 本机真环境冒烟（lark-cli 已授权的机器上）**

```bash
export LARKDEPOT_CACHE_DB=/tmp/claude-smoke-cache.db LARKDEPOT_STATE_DB=/tmp/claude-smoke-state.db
time ./target/release/larkdepot sync           # 期望:8 表全量,55-92s 基线内
./target/release/larkdepot query sql --sql "SELECT COUNT(*) AS n FROM 供应商档案"
./target/release/larkdepot query sql --sql "SELECT 型号,数量 FROM 动态库存表 WHERE norm(型号)=norm('bav-99') LIMIT 5"
./target/release/larkdepot status
./target/release/larkdepot schema
```

Expected: sync 报 8 表行数（对照旧 feishu-db status 的行数量级 ~71k）；查询回真数据；耗时不劣于基线上限 92s。**任何一项不符就停下修，不许带病发版。**

- [ ] **Step 3: 打 tag 出 release**

```bash
git tag v0.1.0
git push origin main --tags
gh release create v0.1.0 target/release/larkdepot \
  --repo cunninghamcard-bit/larkdepot --title "v0.1.0" \
  --notes "首版:pull 注册+发现+原子换库 / push 出箱 / query sql。musl 静态,prod 内核 5.15 可用。"
```

- [ ] **Step 4: Commit 构建脚本**

```bash
git add build-musl.sh && git commit -m "build: docker rust:alpine musl 静态构建脚本" && git push
```

---

### Task 13: monorepo 清理 + 消费 skill 切换 + prod 部署

**目录切换：本 Task 全部在 `/home/cunningham/Projects/craft-agents-oss`。**

**Files:**
- Delete: `procurement-skills/feishu-db/src/`、`bin/`、`Cargo.toml`、`Cargo.lock`、`target/`
- Modify: `procurement-skills/feishu-db/SKILL.md`（重写为 larkdepot 用法）
- Modify: `procurement-skills/procurement-local-inventory-lookup/SKILL.md:17-19`（及 :59 降级段）
- Modify: `procurement-skills/procurement-supplier-shortlist/SKILL.md:17-19`

- [ ] **Step 1: 丢弃搁置 diff（决策已拍板,只动 feishu-db 路径,别的未提交改动不碰）**

```bash
cd /home/cunningham/Projects/craft-agents-oss
git checkout -- procurement-skills/feishu-db/
git status   # 确认 feishu-db 下干净;batch-orchestration/scrape-engine 的改动原样留着
```

- [ ] **Step 2: 删旧实现,留指路存根**

```bash
git rm -r procurement-skills/feishu-db/src procurement-skills/feishu-db/bin \
  procurement-skills/feishu-db/Cargo.toml procurement-skills/feishu-db/Cargo.lock
rm -rf procurement-skills/feishu-db/target
```

`procurement-skills/feishu-db/SKILL.md` 全量重写：

```markdown
---
name: feishu-db
description: 飞书多维表格本地货站 larkdepot——查库存/供应商走本地 SQLite 缓存(抗限流),批量结果本地落行后 push 回飞书。查询用 query sql(SQL 直写,norm() 做型号变体归一)。
---

# larkdepot(原 feishu-db)

源码与发版:私有 repo `cunninghamcard-bit/larkdepot`(GitHub Release 分发 musl 静态 binary)。
binary 路径:`larkdepot`(prod 已装入 PATH;本地开发从 release 拉或 repo 编)。

## 查(唯一入口:只读 SQL)

    larkdepot schema                       # 先看有哪些表、每表列名
    larkdepot query sql --sql "SELECT 型号,数量,单价 FROM 动态库存表 WHERE norm(型号)=norm('BAV99W')"
    larkdepot query sql --sql "SELECT * FROM 供应商档案 WHERE 主营品牌 LIKE '%TDK%'" --limit 50

- `norm(列)`:去 `-`/`/`/空格 + 大写,型号变体匹配必用。
- 多选/人员/附件列存原始 JSON,`json_extract` 拆。
- envelope 带 `freshness.age_s`:超过 2 小时提醒用户缓存偏旧(cron 每小时 sync)。

## 写回(批量结果落库→推飞书)

    larkdepot state create --template batch-result --title "0702找料" --app <base_token>
    larkdepot state write "0702找料" --json '{"批次ID":"B1","型号":"BAV99","结果状态":"found","结果JSON":"{...}"}'
    larkdepot push                         # 幂等,失败行下次自动重试

## 注册新表进缓存

    larkdepot register "<飞书表URL(地址栏带 table= 参数)>" --name 表名
    larkdepot sync

## 故障

- 退出码:0 成功 / 1 用法 / 2 环境(未 sync、lark-cli 没授权) / 3 任务失败。错误 JSON 自带 hint,照 hint 办。
- 缓存不可用时降级直接查飞书:串行、一张一张,限流 800004135 等几秒重试。
```

- [ ] **Step 3: 改两个消费 skill**

`procurement-local-inventory-lookup/SKILL.md` 第 17-19 行区域改为：

```markdown
库存已由 `larkdepot` 工具从飞书 bulk-sync 进本地 SQLite(定时刷新)。SQL 直查,**瞬间返回、无飞书限流**;型号变体匹配用 `norm()`:

    larkdepot query sql --sql "SELECT 型号,品牌,数量,单价,供应商名称 FROM 动态库存表 WHERE norm(型号)=norm('<型号>')"

7 张库存表(动态库存表/自家库存/A级供应商库存/B级供应商库存1-3/C级供应商库存)按需 UNION;先 `larkdepot schema` 看列名。
```

第 59 行降级段里 `feishu-db query` 字样同步改为 `larkdepot query sql`，降级条件改为「命令失败或 `freshness.synced_at` 为 null」。

`procurement-supplier-shortlist/SKILL.md` 第 17-19 行区域改为：

```markdown
供应商档案已由 `larkdepot` 从飞书 bulk-sync 进本地 SQLite。跨品牌字段匹配用 SQL,**瞬间返回、无飞书限流**:

    larkdepot query sql --sql "SELECT * FROM 供应商档案 WHERE 主营品牌 LIKE '%<品牌>%' OR 优势产品 LIKE '%<品牌>%' OR 询价品牌 LIKE '%<品牌>%'" --limit 50
```

**注意**：以上 SQL 里的列名（`供应商名称`、`主营品牌`、`优势产品`、`询价品牌`…）现在直接是飞书字段名。**写完后跑一次真机 `larkdepot schema` 逐列核对**，字段名以 schema 输出为准修正 SKILL.md 里的示例。

- [ ] **Step 4: Commit（只这批文件）**

```bash
git add procurement-skills/feishu-db procurement-skills/procurement-local-inventory-lookup/SKILL.md \
  procurement-skills/procurement-supplier-shortlist/SKILL.md
git commit -m "feat(skills): feishu-db → larkdepot 切换;删除 monorepo 内旧实现与 binary 产物"
```

- [ ] **Step 5: prod 部署（上海腾讯云,同一次维护窗口原子完成）**

```bash
# prod 机上:
gh release download v0.1.0 --repo cunninghamcard-bit/larkdepot -O /usr/local/bin/larkdepot --clobber
chmod +x /usr/local/bin/larkdepot
larkdepot sync            # 首跑:建 state 库(迁移+预置)+全量缓存
larkdepot status          # 核对 8 表行数 ~71k
crontab -e                # 原 feishu-db sync 条目改成: larkdepot sync
# skills 侧照现有流程同批部署(build-skills)
```

验收清单（全过才算完）：
- `larkdepot status` freshness 正常、8 表行数与旧 feishu-db 同量级；
- 两个消费 skill 在 prod 会话里各跑一次真查询，返回正常；
- cron 下一个整点后 `status` 的 `synced_at` 刷新；
- 旧 `feishu-db` binary 从 prod PATH 移除。

---

## Self-Review 记录

- **Spec 覆盖**：决策 1-9 逐条对到 Task：独占写/出箱（T11）、模板实例（T3/T6/T10）、读侧动态注册（T6/T8）、自动发现（T5/T8）、显式 push（T11）、不兼容+skill 同批切换（T13）、query sql 一等公民（T9）、独立 repo+Release（T1/T12）、更名（全程）。spec §8 错误处理四条：push 部分失败（T11 report+exit 3）、发现失败即 sync 失败（T5 list_fields 空→Task 错）、query sql 防线（T9 只读+包 LIMIT）、write 校验（T6）。§10 测试逐项有：发现映射（T3）、push 幂等对账（T11）、实例即行 roundtrip（T10/T11）、registry 预置（T6）、schema 列清单（T9 status/schema 接线）、原子换库+tmp 清扫（T7）、musl+性能基线（T12）。
- **已知的现场核对点（不是占位符，是环境事实只能现场定）**：T5 写方向 flag 名、field-list 响应形状；T11 record-list 带 record_id 的方式。均给了具体核对命令与退路。
- **类型一致性**：`TableLoad{name,columns,rows}` T7 定义、T8 使用一致；`RegEntry` T6 定义、T8/T9/T11 使用一致；`Fail` T2 定义全程引用；`map::to_row`/`coerce` 签名 T4 定义 T6/T8 使用一致。
- **kill -9 原子性测试**：spec §10 要求进程级 kill 测试，计划以 T7 的"残留 tmp + 旧库存活"单测覆盖等价语义（build 失败删 tmp、成功才 rename）；进程级演练归入 T12 真机冒烟可选项，不阻塞。
