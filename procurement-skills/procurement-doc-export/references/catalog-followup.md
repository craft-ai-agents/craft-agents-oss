# 跟单单据（followup）目录

本文件是 `procurement-doc-export` 的**跟单分册**：何时开哪种单据、币种怎么路由、blank 路径与数据从哪来。  
**不是**独立 skill；通用流程（读数 → markdown 预览确认 → 填模板 → 交付）见父级 [SKILL.md](../SKILL.md)。

**已实现渲染：**

| 单据 | 脚本 | blank |
|------|------|-------|
| 美金请款发票 PI（USD） | `scripts/render_pi.py` | `templates/美金请款发票模板PI.xlsx` |
| 日本請求書 / イノ間（JPY） | `scripts/render_jp_invoice.py` | `templates/followup/jp-ino-invoice/blank.xlsx` |
| 見積書 | `scripts/render_followup.py --kind quotation` | `templates/followup/quotation/blank.xlsx` |
| 竹菱 PI | `scripts/render_followup.py --kind takebishi-pi` | `templates/followup/takebishi-pi/blank.xlsx` |
| 取扱手数料 | `scripts/render_followup.py --kind takebishi-fee` | `templates/followup/takebishi-fee/blank.xlsx` |

自动化：`scripts/test_render_all_docs.py`（FollowupRenders）+ `test_render_jp_invoice.py`。

---

## 1. 何时开哪种单据

| 单据 | 触发场景（用户说法） | 币种 / 对象 | 状态 | blank |
|------|----------------------|-------------|------|--------|
| **見積書**（报价单） | “出見積 / 报价单 / quotation” | 报价币种按业务/订单；**对客户**报价 | **已实现** | `templates/followup/quotation/blank.xlsx` |
| **日本請求書 / イノ間請求書** | “日本请款 / 請求書 / イノ間” | **JPY** 侧请款；主体多是 FAR ↔ イノ | **已实现** | `templates/followup/jp-ino-invoice/blank.xlsx` |
| **美金 PI**（Proforma Invoice） | “开 PI / 美金请款发票 / 请款发票” | **USD**；对外客户 Bill To/Ship To | **已实现** | `templates/美金请款发票模板PI.xlsx` |
| **竹菱 PI** | “竹菱 PI / たけびし PI / TAKEBISHI invoice” | 竹菱专用英文 PI 版式 | **已实现** | `templates/followup/takebishi-pi/blank.xlsx` |
| **取扱手数料** | “手续费请求 / 取扱手数料 / 竹菱手续费” | 手续费行请款（非整单货品 PI） | **已实现** | `templates/followup/takebishi-fee/blank.xlsx` |

**互斥 / 优先：**

1. 用户说“请款/PI/发票”且订单币种 **USD** → **美金 PI**（SKILL 主路径），不要误开 見積書。  
2. 用户说“请款/請求書”且币种 **JPY** → **日本請求書**（jp-ino-invoice），**不要**走 `render_pi` / 美金模板。  
3. 明确“报价 / 見積”才用 quotation blank。  
4. 明确“手续费 / 取扱手数料”才用 takebishi-fee；不要把货品行塞进手续费单。  
5. 客户是竹菱且业务指定“用竹菱 PI 版式” → takebishi-pi；否则 USD 通用 PI 仍走 `render_pi`。

样本（填好的对照，非 blank）：`samples/followup/**`。

---

## 2. 币种路由

| 订单/业务币种 | 请款类单据 | 说明 |
|---------------|------------|------|
| **USD** | 美金 PI | SKILL「已实现：美金请款发票 PI」+ `render_pi.py` |
| **JPY** | 日本請求書 | SKILL「已实现：日本請求書」+ `render_jp_invoice.py`；**禁止** `render_pi` |
| 仅报价、未定请款 | 見積書 | `render_followup.py --kind quotation`；币种以业务确认的报价币种为准 |
| 手续费 | 取扱手数料 | `render_followup.py --kind takebishi-fee`；金额规则问业务，不猜 |

`build_pi_context.py` 对非 USD 会直接退出并提示走日本請求書——硬路由。

---

## 3. 模板路径与脚本

路径均相对 skill 根 `procurement-doc-export/`。`templates/**/*.xlsx` **gitignore**。

| 用途 | blank | 脚本 |
|------|-------|------|
| 見積書 | `templates/followup/quotation/blank.xlsx` | `render_followup.py --kind quotation` |
| 日本請求書 | `templates/followup/jp-ino-invoice/blank.xlsx` | `render_jp_invoice.py` |
| 美金 PI | `templates/美金请款发票模板PI.xlsx` | `render_pi.py` |
| 竹菱 PI | `templates/followup/takebishi-pi/blank.xlsx` | `render_followup.py --kind takebishi-pi` |
| 取扱手数料 | `templates/followup/takebishi-fee/blank.xlsx` | `render_followup.py --kind takebishi-fee` |

### blank sheet 名

| blank | sheet |
|-------|--------|
| quotation | `样板` |
| jp-ino-invoice | `样板` |
| takebishi-fee | `样本` |
| takebishi-pi | `样板` |
| 美金请款发票模板PI | 以 `render_pi.py` 约定为准 |

### CLI 示例

```bash
uv run --with openpyxl python3 scripts/render_followup.py \
  --kind quotation \
  --template templates/followup/quotation/blank.xlsx \
  --out 見積.xlsx --data ctx.json
```

**quotation context：** `date`, `to`, `from_block`, `currency`, `items[{part,qty,price,unit,dc,lead_time}]`  
**takebishi-pi：** `invoice_no`, `invoice_date`, `po_number`, `terms`, `ship_date`, `bill_to`/`ship_to`, `items[{part,qty,price,desc}]`  
**takebishi-fee：** `invoice_no`, `invoice_date`, `subject`, `items[{part,qty,price,unit}]`

---

## 4. 填充模型

- Excel 表单 + 合并格 + 公式；openpyxl 坐标写可变数据（`xlsx_common.set_cell` merge-safe）。  
- 金额/合计**保留公式**；只填数量/单价/品名。  
- 货品行：插行/删行 + 合并区随移（`adjust_item_block`）。  
- 生成前确认、交付可编辑 `.xlsx`、对用户不暴露工具名——继承 SKILL.md。

---

## 5. 数据来源

| 数据 | 来源 | 缺口时 |
|------|------|--------|
| 货品行 | 飞书「客户订单审批」 | 查无 → 如实说 |
| 客户抬头 | `customers.json` | 未命中 → 要补，禁止虚构 |
| 番号 / 日期 / PO | 订单 + 业务确认 | 不确定就问 |
| 取扱手数料金额 | 业务给定 | 缺就停，不估算 |

除美金 PI 外尚无 `build_*_context`；允许手写 JSON + 预览确认。

---

## 6. Rationalization Table

| Excuse | Reality |
|--------|---------|
| “JPY 单用美金 PI 脚本改币种符号。” | 硬切：USD→PI，JPY→日本請求書。 |
| “パルス地址网上能搜到，先填上。” | 抬头只认 `customers.json`。 |
| “手续费按货值百分比自己算。” | 不是本 skill 计算职责。 |
| “見積和 PI 差不多，统一用 PI 模板。” | 版式与触发不同，按上表选 blank。 |

---

## 7. 与其它分册的边界

- **跟单** = 报价 / 请款 / 手续费（本文件）。  
- **采购合同 PO、报关/出货、对冲** 见各自 catalog / SKILL。
