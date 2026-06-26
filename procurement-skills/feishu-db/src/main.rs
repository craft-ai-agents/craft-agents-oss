//! feishu-db —— 飞书库存/供应商表的本地 SQLite 缓存 CLI。
//!
//! 为什么:库存/供应商表有限、慢变,而飞书 record-search 有限流(800004135),技能直接查
//! 飞书要"串行 + LLM 重试",是整条找料流程最慢最脆的一环。把这些表 bulk-sync 进本地 SQLite,
//! 技能改查本地 —— 热路径**零飞书调用**,限流消失、查询瞬间、结构化输出。sync 用 tokio
//! **并发**拉(record-list 容许并发,不撞限流),全量 ~分钟级。
//!
//! 用法:
//!   feishu-db sync                    全量并发拉飞书 → 本地 DB(定时 cron 跑)
//!   feishu-db query    --part  <型号>  查库存(变体匹配)→ JSON
//!   feishu-db supplier --brand <品牌>  查供应商档案 → JSON
//!   feishu-db status                  看缓存状态(各表行数 + 同步时间)
//!
//! DB:$FEISHU_DB_PATH,默认 ~/.craft-agent/feishu-cache.db。依赖 lark-cli 已 `--as user` 授权。

mod coerce;
mod config;
mod db;
mod fetch;

use anyhow::Result;
use clap::{Parser, Subcommand};
use serde_json::json;

#[derive(Parser)]
#[command(name = "feishu-db", version, about = "飞书库存/供应商表本地 SQLite 缓存 CLI")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 全量并发拉飞书 → 本地 DB(唯一碰飞书的地方,定时跑)
    Sync,
    /// 查库存(型号变体匹配)
    Query {
        #[arg(long)]
        part: String,
    },
    /// 查供应商档案
    Supplier {
        #[arg(long)]
        brand: String,
    },
    /// 看缓存状态(各表行数 + 同步时间)
    Status,
}

fn now_str() -> String {
    std::process::Command::new("date")
        .arg("+%Y-%m-%d %H:%M:%S")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Sync => {
            let now = now_str();
            let (inv, sup) = fetch::fetch_all().await?;
            let mut con = db::open()?;
            let mut counts = serde_json::Map::new();
            for (grade, recs) in &inv {
                let n = db::write_inventory(&mut con, grade, recs, &now)?;
                counts.insert(grade.to_string(), json!(n));
            }
            let n = db::write_suppliers(&mut con, &sup, &now)?;
            counts.insert("供应商档案".into(), json!(n));
            println!("{}", json!({"db": db::db_path(), "synced_at": now, "counts": counts}));
        }
        Cmd::Query { part } => {
            println!("{}", db::query(&db::open()?, &part)?);
        }
        Cmd::Supplier { brand } => {
            println!("{}", db::query_supplier(&db::open()?, &brand)?);
        }
        Cmd::Status => {
            let con = db::open()?;
            println!("{}", json!({"db": db::db_path(), "tables": db::sync_summary(&con)?}));
        }
    }
    Ok(())
}
