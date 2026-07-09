# 单据包：shipping-customs（出口/进口/不报关/国内送货）

本 skill 内 **报关与物流单据** 的选单与模板索引。  
**状态：渲染已实现（汇总/主表级）** — `scripts/render_shipping.py --kind no-declaration|export-declaration|import-declaration|domestic-delivery`。回归：`scripts/test_render_all_docs.py`（ShippingRenders）。出口报关**子表**（合同/发票/装箱等）细坐标尚未全铺，只保证 汇总 + currency sheet 套选择。通用流程见 [`../SKILL.md`](../SKILL.md)。

---

## 何时出哪套（包内路由）

用户要「报关资料 / 出口资料 / 装箱单 / 申报要素 / 送货单」等时，**先定单据类型**再开对应 blank。  
判断以业务明示 + 飞书侧「是否退税 / 申报方式 / 货物流向」为准；**不确定就问用户，不猜**。

| 条件（触发） | 出哪套 | 模板目录 |
|---|---|---|
| 跨境出口、**走正式报关 / 退税**（用户说「出口报关」「正式报关」「退税资料」） | **出口报关** | `templates/shipping-customs/export-declaration/` |
| 跨境出口、**不报关 / 不退税**（用户说「不报关」「简易出口资料」） | **不报关** | `templates/shipping-customs/no-declaration/` |
| **进口侧**资料（进口合同/发票/装箱/货物说明；用户说「进口报关」） | **进口报关** | `templates/shipping-customs/import-declaration/` |
| **国内段**送货（用户说「国内送货单」「送货单」） | **国内送货单** | `templates/shipping-customs/domestic-delivery/` |

补充：

| 补充规则 | 说明 |
|---|---|
| 出口报关 vs 不报关 | 主分叉是**是否正式报关/退税**（见业务问卷口径），不是「有没有跨境」 |
| 币种套（出口报关内） | 模板内有日元套 / 美元套 / 1039 套 sheet；**选哪套 = 待字段映射确认后按订单币种/业务规则填对应 sheet**，禁止擅自改版式拼 sheet |
| 出口 + 进口端 | 出口报关 blank 内嵌部分进口端 sheet；与独立「进口报关」包是否同出 **待业务确认**，未确认不默认全出 |
| 与美金 PI | PI（`templates/美金请款发票模板PI.xlsx`）是请款发票，**不是**本包路由结果；本包不报关套内含 PI sheet，用途不同 |

---

## 模板路径

路径相对 **本 skill 根**（`procurement-doc-export/`）。blank 含业务样例数据，本地/服务器有、**不进公开仓**。

| 套 | blank | 旧扁平名（同内容族，兼容引用） |
|---|---|---|
| 不报关 | `templates/shipping-customs/no-declaration/blank.xlsx` | `templates/INO_LG_不报关出口资料.xlsx` |
| 出口报关 | `templates/shipping-customs/export-declaration/blank.xlsx` | `templates/INO_LG_出口报关文件模板.xlsx` |
| 进口报关 | `templates/shipping-customs/import-declaration/blank.xlsx` | `templates/INO_LG_进口报关文件模板.xlsx` |
| 国内送货单 | `templates/shipping-customs/domestic-delivery/blank.xlsx` | （无对应 INO_LG_*） |

样例（字段发现用，gitignored）：`samples/shipping-customs/<套名>/`。

### Sheet 名（blank 实测）

| 套 | sheets |
|---|---|
| 不报关 | `汇总`, `PI`, `PACKING LIST` |
| 出口报关 | `报关流程`, `清关HS`, `汇总`, `出口报关单`, `出口合同`, `出口发票`, `出口装箱单`, `出口申报要素`, `packinglist`, `（美元）出口报关单 `, `（美）出口合同 `, `（美）出口发票 `, `（美）出口装箱单 `, `（美）出口申报要素 `, `（美）packinglist`, `进口合同`, `进口发票`, `进口装箱单`, `进口货物说明表`, `出口申报要素 (2)`, `1039发票`, `1039申报要素`, `1039出口货物确认函` |
| 进口报关 | `汇总`, `进口合同 `, `进口发票 `, `进口装箱单 `, `进口货物说明表 `, `出口申报要素 ` |
| 国内送货单 | `送货单`, `送货单0128` |

（部分 sheet 名尾部有空格，映射时按实际 workbook 名匹配。）

---

## 填充模型与 CLI

- 贸易单据 = 带版式 + 合并单元格 + 公式的 Excel 表单。
- 脚本：`scripts/render_shipping.py`；共享 `xlsx_common.set_cell`（merge-safe）。
- **不报关 汇总**：Sold to / seller / PO / 品牌 / 型号 / HS 等（与 no-declaration blank 一致）。
- **出口 汇总**：A/B 标签布局（型号 B9、HS B10、品牌 B11…）；`currency_set` 记入 A35。
- **出口币种套业务 sheet（必填货品代表字段）**：
  - `cny`（默认）：`出口发票!B16/C16/D16`、`出口合同!B17/D17`、`出口装箱单!B13`
  - `usd`：`（美）出口装箱单 !B13/D13`（发票公式从装箱单引用）
  - `jpy1039`：`1039发票!E17` 型号、`D17` HS
- **进口 汇总**：seller + 合同号 + 型号/数量/单价（sheet 名可能有尾空格）。
- **国内送货**：`送货单` sheet 收货方 + 货品行。
- 生成前仍须：**markdown 预览 → 用户确认 → 再写 xlsx**。

```bash
uv run --with openpyxl python3 scripts/render_shipping.py \
  --kind export-declaration \
  --template templates/shipping-customs/export-declaration/blank.xlsx \
  --out export.xlsx --data ctx.json
```

**context 要点：** `items[{part,brand,hs_code,qty,price,...}]`；出口加 `currency_set`；不报关加 `sold_to`/`po_number`；进口加 `seller`/`contract_no`；国内加 `receiver_company` 等。

---

## 数据来源

读表见 **SKILL.md「数据来源（飞书 Base）」**。本包 **尚无 build_shipping_context**；下列字段 context 有则填、无则留空，**禁止虚构**。

| 字段族 | 可能来源 | 状态 |
|---|---|---|
| 订单货品行 | 客户订单审批 | 可手填 JSON |
| 客户 / Bill To / Ship To | customers.json / 发货出库 | 缺则空 |
| 是否报关 / 申报方式 | 物流表 + 用户明示 | 路由用 |
| HS 编码 | 清关HS / 外部可查 / 用户 | **禁止编** |
| 件数 / 毛净重 / 体积 | 人工或出库 | **禁止估** |
| 运输方式 / 运费 | 国际运费表或人工 | 可选填 |
| 国内送货收货信息 | 发货出库或用户 | 缺则问 |

---

## 明确不做（Out of scope）

| 不做 | 原因 |
|---|---|
| singlewindow（国际贸易单一窗口）门户：委托、缴税、下载放行等 | **人工**操作；本 skill 只出可编辑资料 Excel |
| 替业务决定是否退税/是否报关 | 业务判断；agent 只按已定类型填模板 |
| 改订单表、自动下单、自动缴税 | 见 SKILL.md 边界 |
| 擅自改模板版式 / 增删业务 sheet | 只填数据 |

---

## Rationalization Table（本包）

| Excuse | Reality |
|---|---|
| 「HS 查不到，我先编一个相近编码。」 | 禁止虚构 HS。先 `清关HS`，再外部可查来源；仍无则标缺、让人补。 |
| 「报关套 sheet 太多，只填几个主表就行。」 | 按该套业务要出的 sheet 填；未实现映射前说明未实现，不半套糊弄交付。 |
| 「用户急，跳过预览直接出 xlsx。」 | 必须先 markdown 预览并确认（SKILL 通用流程）。 |
| 「模板行不够，我改版式/合并单元格适配。」 | 版式以业务 blank 为准；行数用插删行机制，不重排版。 |
| 「重量件数没有，按经验估一个。」 | 毛净重/件数/体积无可靠来源就空着或问人，不估。 |
| 「我去 singlewindow 帮你点申报。」 | 门户操作人工；只交付 Excel 资料。 |
