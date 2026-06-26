//! 飞书字段值的归一化:值→展示字符串、按字段名优先取值、型号归一。

use serde_json::{Map, Value};

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

/// 按字段名优先级取第一个非空展示值(各表字段名不一)。
pub fn pick(rec: &Map<String, Value>, names: &[&str]) -> String {
    for n in names {
        if let Some(v) = rec.get(*n) {
            let s = to_display(v);
            if !s.is_empty() {
                return s;
            }
        }
    }
    String::new()
}

/// 去符号 + 大写,供变体匹配(原始/去符号 归一到同一键)。
pub fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '-' | '/' | ' ' | '\t'))
        .collect::<String>()
        .to_uppercase()
}
