//! 飞书抓取层 —— 通过 lark-cli(唯一握 user token 的)取数,但用 tokio **并发**翻页。
//!
//! 速度:lark-cli 每页 fork 一次 Node 进程(~2s),串行很慢。record-list 实测**容许并发、
//! 不撞限流**(record-search 才限流),所以并发跑:全局 Semaphore 控总并发(MAX_CONCURRENT),
//! 表间 + 页间都并发。实测 4 页 串行 8s → 并发 1s。

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{Map, Value};
use tokio::process::Command;
use tokio::sync::Semaphore;

use crate::config::{BASE, INVENTORY_TABLES, SUPPLIER_TID};

const PAGE: usize = 200; // lark-cli --limit 上限
const MAX_CONCURRENT: usize = 8; // 全局并发上限(实测:8/8 稳,12 偶有空响应)
const RETRIES: u32 = 4; // 偶发空 stdout 重试

pub type Record = Map<String, Value>;

/// 单次取一页(无重试)。空 stdout / 非 JSON / ok!=true 都返回 Err 交给重试。
async fn one_attempt(base: &str, tid: &str, offset: usize) -> Result<(Vec<Record>, bool)> {
    let out = Command::new("lark-cli")
        .args([
            "--format", "json", "base", "+record-list", "--as", "user",
            "--base-token", base, "--table-id", tid,
            "--limit", &PAGE.to_string(), "--offset", &offset.to_string(),
        ])
        .output()
        .await
        .context("lark-cli 起不来")?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let root: Value = serde_json::from_str(&stdout)
        .map_err(|_| anyhow!("空/非 JSON({} 字节)", stdout.len()))?;
    if root.get("ok") != Some(&Value::Bool(true)) {
        return Err(anyhow!(
            "ok!=true(token 可能过期需重登): {}",
            root.get("msg").map(|m| m.to_string()).unwrap_or_default()
        ));
    }
    let data = root.get("data").cloned().unwrap_or(Value::Null);
    let fields = data.get("fields").and_then(Value::as_array).cloned().unwrap_or_default();
    let recs = data.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
    let has_more = data.get("has_more").and_then(Value::as_bool).unwrap_or(false);

    let mut out_recs = Vec::with_capacity(recs.len());
    for vals in &recs {
        if let Some(arr) = vals.as_array() {
            let mut m = Map::new();
            for (i, f) in fields.iter().enumerate() {
                if let (Some(name), Some(v)) = (f.as_str(), arr.get(i)) {
                    m.insert(name.to_string(), v.clone());
                }
            }
            out_recs.push(m);
        }
    }
    Ok((out_recs, has_more))
}

/// 拉一页:semaphore 限并发 + 重试(并发偶发空响应,退避重试),返回 (records, has_more)。
async fn fetch_page(
    sem: Arc<Semaphore>,
    base: String,
    tid: String,
    offset: usize,
) -> Result<(Vec<Record>, bool)> {
    let _permit = sem.acquire().await.expect("semaphore closed");
    let mut last = String::new();
    for attempt in 0..RETRIES {
        match one_attempt(&base, &tid, offset).await {
            Ok(r) => return Ok(r),
            Err(e) => {
                last = e.to_string();
                tokio::time::sleep(Duration::from_millis(200 * u64::from(attempt + 1))).await;
            }
        }
    }
    Err(anyhow!("offset={offset} 重试 {RETRIES} 次仍失败: {last}"))
}

/// 并发全量拉一张表:每轮并发一批页,直到尾页(短页/has_more=false)。
async fn fetch_table(sem: Arc<Semaphore>, base: &str, tid: &str) -> Result<Vec<Record>> {
    let mut all = Vec::new();
    let mut cursor = 0usize;
    loop {
        let futs: Vec<_> = (0..MAX_CONCURRENT)
            .map(|i| fetch_page(sem.clone(), base.to_string(), tid.to_string(), cursor + i * PAGE))
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

/// 并发拉全部库存表 + 供应商档案。返回 (inventory_by_grade, suppliers)。
pub async fn fetch_all() -> Result<(Vec<(&'static str, Vec<Record>)>, Vec<Record>)> {
    let sem = Arc::new(Semaphore::new(MAX_CONCURRENT));
    let inv_futs = INVENTORY_TABLES.iter().map(|&(_, tid, grade)| {
        let sem = sem.clone();
        async move { Ok::<_, anyhow::Error>((grade, fetch_table(sem, BASE, tid).await?)) }
    });
    let (inv, sup) = tokio::join!(
        futures::future::try_join_all(inv_futs),
        fetch_table(sem.clone(), BASE, SUPPLIER_TID),
    );
    Ok((inv?, sup?))
}
