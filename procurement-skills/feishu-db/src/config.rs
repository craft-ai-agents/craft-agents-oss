//! 飞书源表 + 字段映射配置。改表/加表/改字段名只动这里。

/// 业务库《供应商管理(正式版)》base-token。
pub const BASE: &str = "Mjlkb49B9aoptssVw8Jc0wGwnhh";

/// 库存源表:(表名, table-id, grade 标签)。
pub const INVENTORY_TABLES: &[(&str, &str, &str)] = &[
    ("动态库存表", "tbli1WYTb1Xn2MSa", "动态"),
    ("自家库存", "tblSUjXdehzkxIbK", "自家"),
    ("A级供应商库存", "tblzQbSnVNhGszYA", "A"),
    ("B级供应商库存1", "tbldOthm6zmFonDM", "B1"),
    ("B级供应商库存2", "tblqaoi5UuUGybxF", "B2"),
    ("B级供应商库存3", "tbld53dBj2dvI1R6", "B3"),
    ("C级供应商库存", "tblBbvvRKB0Ziioz", "C"),
];

/// 供应商档案表 table-id。
pub const SUPPLIER_TID: &str = "tblbtuMHFIOr6Oss";

// 字段名各表不一(型号/品名混用),按优先级取第一个非空。
pub const MODEL_F: &[&str] = &["型号", "品名", "品名/型号", "料号", "MPN", "Model"];
pub const BRAND_F: &[&str] = &["品牌", "厂牌", "Brand"];
pub const STOCK_F: &[&str] = &["库存数量", "数量", "库存", "Stock"];
pub const PRICE_F: &[&str] = &["单价", "价格", "目标价/价格", "目标价", "Price"];
pub const MOQ_F: &[&str] = &["MOQ"];
pub const SUPPLIER_F: &[&str] = &["供应商名称", "供应商名称文本", "供应商全称", "供应商", "Supplier"];
pub const BATCH_F: &[&str] = &["批次"];
pub const TYPE_F: &[&str] = &["类型"]; // 动态表:出货/求购
pub const UPDATED_F: &[&str] = &["更新时间", "发布时间", "更新日期"];
pub const SUP_BRAND_F: &[&str] = &["主营品牌", "优势产品", "询价品牌"];

// 供应商档案表:候选名单输出所需的多字段(query_supplier 从 raw re-pick)。
pub const SUP_TYPE_F: &[&str] = &["供应商类型"];
pub const SUP_GRADE_F: &[&str] = &["供应商等级", "等级"];
pub const SUP_MAINBRAND_F: &[&str] = &["主营品牌"];
pub const SUP_ADV_F: &[&str] = &["优势产品"];
pub const SUP_CONTACT_F: &[&str] = &["联系方式"];
pub const SUP_MEDIA_F: &[&str] = &["联系媒介"];
pub const SUP_SITE_F: &[&str] = &["官网|店铺", "官网", "店铺"];
pub const SUP_STATUS_F: &[&str] = &["供应商状态"];
pub const SUP_NOTE_F: &[&str] = &["备注"];
pub const SUP_SCORE_F: &[&str] = &["总分"];
