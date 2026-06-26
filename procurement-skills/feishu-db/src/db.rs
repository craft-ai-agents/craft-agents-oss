//! 本地 SQLite 缓存层 —— schema、写入(全表刷新)、查询(库存变体匹配 / 供应商)。

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::coerce::{normalize, pick};
use crate::config::*;
use crate::fetch::Record;

pub fn db_path() -> String {
    std::env::var("FEISHU_DB_PATH").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{home}/.craft-agent/feishu-cache.db")
    })
}

pub fn open() -> Result<Connection> {
    let path = db_path();
    if let Some(d) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(d).ok();
    }
    let con = Connection::open(&path).with_context(|| format!("打开 DB {path}"))?;
    con.execute_batch(
        "CREATE TABLE IF NOT EXISTS inventory(grade TEXT, model TEXT, model_norm TEXT, brand TEXT,
           stock TEXT, price TEXT, moq TEXT, supplier TEXT, batch TEXT, type TEXT, updated TEXT, raw TEXT);
         CREATE INDEX IF NOT EXISTS ix_norm ON inventory(model_norm);
         CREATE INDEX IF NOT EXISTS ix_brand ON inventory(brand);
         CREATE TABLE IF NOT EXISTS suppliers(supplier TEXT, brands TEXT, raw TEXT);
         CREATE INDEX IF NOT EXISTS ix_sbrands ON suppliers(brands);
         CREATE TABLE IF NOT EXISTS sync_meta(source TEXT PRIMARY KEY, synced_at TEXT, count INTEGER);",
    )?;
    Ok(con)
}

/// 全表刷新一个 grade 的库存:删旧 + 批量插 + 记 sync_meta。
pub fn write_inventory(con: &mut Connection, grade: &str, recs: &[Record], now: &str) -> Result<usize> {
    let tx = con.transaction()?;
    tx.execute("DELETE FROM inventory WHERE grade=?1", params![grade])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO inventory VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        )?;
        for d in recs {
            let model = pick(d, MODEL_F);
            stmt.execute(params![
                grade, model, normalize(&model), pick(d, BRAND_F), pick(d, STOCK_F),
                pick(d, PRICE_F), pick(d, MOQ_F), pick(d, SUPPLIER_F), pick(d, BATCH_F),
                pick(d, TYPE_F), pick(d, UPDATED_F), Value::Object(d.clone()).to_string()
            ])?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO sync_meta VALUES(?1,?2,?3)",
        params![grade, now, recs.len() as i64],
    )?;
    tx.commit()?;
    Ok(recs.len())
}

pub fn write_suppliers(con: &mut Connection, recs: &[Record], now: &str) -> Result<usize> {
    let tx = con.transaction()?;
    tx.execute("DELETE FROM suppliers", [])?;
    {
        let mut stmt = tx.prepare("INSERT INTO suppliers VALUES(?1,?2,?3)")?;
        for d in recs {
            let brands = SUP_BRAND_F
                .iter()
                .map(|k| d.get(*k).map(crate::coerce::to_display).unwrap_or_default())
                .collect::<Vec<_>>()
                .join(" ");
            stmt.execute(params![pick(d, SUPPLIER_F), brands, Value::Object(d.clone()).to_string()])?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO sync_meta VALUES(?1,?2,?3)",
        params!["供应商档案", now, recs.len() as i64],
    )?;
    tx.commit()?;
    Ok(recs.len())
}

fn synced_at(con: &Connection) -> String {
    con.query_row(
        "SELECT MAX(synced_at) FROM sync_meta WHERE source!='供应商档案'",
        [],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
    .unwrap_or_default()
}

/// 查库存:变体匹配(精确 model_norm / 互为前缀的模糊),跨 grade 聚合。
pub fn query(con: &Connection, part: &str) -> Result<Value> {
    let norm = normalize(part);
    let mut stmt = con.prepare(
        "SELECT grade, model, brand, stock, price, moq, supplier, batch, type, updated,
           CASE WHEN model_norm=?1 THEN 'exact' ELSE 'fuzzy' END
         FROM inventory
         WHERE model_norm<>'' AND (model_norm=?1 OR model_norm LIKE ?1||'%' OR ?1 LIKE model_norm||'%')
         ORDER BY (model_norm=?1) DESC, grade",
    )?;
    let rows: Vec<Value> = stmt
        .query_map(params![norm], |r| {
            Ok(json!({
                "grade": r.get::<_, String>(0)?, "model": r.get::<_, String>(1)?,
                "brand": r.get::<_, String>(2)?, "stock": r.get::<_, String>(3)?,
                "price": r.get::<_, String>(4)?, "moq": r.get::<_, String>(5)?,
                "supplier": r.get::<_, String>(6)?, "batch": r.get::<_, String>(7)?,
                "type": r.get::<_, String>(8)?, "updated": r.get::<_, String>(9)?,
                "match": r.get::<_, String>(10)?,
            }))
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(json!({
        "part": part, "rows": rows, "synced_at": synced_at(con),
        "note": "本地缓存快照,非实时;下单前对中标行可再 live 复核"
    }))
}

pub fn query_supplier(con: &Connection, brand: &str) -> Result<Value> {
    let like = format!("%{brand}%");
    let mut stmt = con.prepare("SELECT supplier, raw FROM suppliers WHERE brands LIKE ?1 LIMIT 50")?;
    let rows: Vec<Value> = stmt
        .query_map(params![like], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .map(|(name, raw)| {
            // raw 存了整条记录,候选名单要的多字段在这里 re-pick(避免再碰飞书)。
            let rec: Map<String, Value> = serde_json::from_str(&raw).unwrap_or_default();
            json!({
                "supplier": if name.is_empty() { pick(&rec, SUPPLIER_F) } else { name },
                "type": pick(&rec, SUP_TYPE_F),
                "grade": pick(&rec, SUP_GRADE_F),
                "main_brands": pick(&rec, SUP_MAINBRAND_F),
                "advantage": pick(&rec, SUP_ADV_F),
                "contact": pick(&rec, SUP_CONTACT_F),
                "media": pick(&rec, SUP_MEDIA_F),
                "site": pick(&rec, SUP_SITE_F),
                "status": pick(&rec, SUP_STATUS_F),
                "note": pick(&rec, SUP_NOTE_F),
                "score": pick(&rec, SUP_SCORE_F),
            })
        })
        .collect();
    Ok(json!({"brand": brand, "rows": rows, "synced_at": synced_at(con)}))
}

/// 各表同步时间 + 行数(给 sync 输出 / status)。
pub fn sync_summary(con: &Connection) -> Result<Map<String, Value>> {
    let mut stmt = con.prepare("SELECT source, count, synced_at FROM sync_meta")?;
    let mut m = Map::new();
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
    })?;
    for row in rows.filter_map(Result::ok) {
        m.insert(row.0, json!({"count": row.1, "synced_at": row.2}));
    }
    Ok(m)
}
