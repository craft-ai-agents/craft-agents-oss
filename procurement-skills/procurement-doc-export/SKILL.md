---
name: procurement-doc-export
description: Use when 用户要按模板生成可编辑贸易/财务/采购单据——请款发票、PI、請求書、見積、报关资料、送货单、采购合同/PO、对账单等。触发说法含「开 PI/请款/报关资料/送货单/采购合同/FAR 订单/見積/請求書/按模板出单据」。
metadata:
  short-description: 按模板生成贸易/财务单据
  lang: zh
---

# 按模板生成贸易/财务单据

把飞书（或用户确认的）订单/采购数据，按业务模板生成**可编辑单据**（请款、报关、送货、采购合同等），下载或发飞书。给可编辑文件是为了让人能再改。模板在 `templates/`（真实数据，本地/服务器 only，不进公开仓）。

通用流程：**定单据类型 → 读数据 → markdown 预览(=确认) → 按模板生成 → 交付**。

## 端到端（TaskBar 表单 → xlsx）

前端 TaskBar 每个单据按钮提交后，用户消息会包含：

1. 人类可读预览  
2. 机器可读代码块 **` ```doc-export-json `**（`{ template, context, mode? }`）

**Agent 标准路径（禁止手抄单元格）：**

1. 从消息提取 `doc-export-json` 块，原样存为 `payload.json`  
2. 预览（可选）：  
   `uv run --with openpyxl python3 .agents/skills/procurement-doc-export/scripts/render_from_form.py --data payload.json --preview-only`  
3. 向用户确认预览内容  
4. 生成：  
   `uv run --with openpyxl python3 .agents/skills/procurement-doc-export/scripts/render_from_form.py --data payload.json --out "<工作区>/单据.xlsx"`  
5. 交付工作区文件路径（或飞书发文件）

- `mode: "feishu_order"`（美金 PI 仅订单号）：脚本会调 `build_pi_context.py`；失败则如实说，勿编数据。  
- `context` 已是对应 `render_*.py` 形状，**不要**再发明字段名。  
- 测试：`scripts/test_render_from_form.py`。

**已实现渲染（JSON context → openpyxl 填 blank → `.xlsx`）：**

| 单据 | 脚本 | 入口 |
|------|------|------|
| 美金请款发票 PI | `scripts/render_pi.py` | 下文「已实现：美金请款发票 PI」 |
| 日本請求書（イノ間） | `scripts/render_jp_invoice.py` | 下文「已实现：日本請求書」 |
| 見積 / 竹菱 PI / 取扱手数料 | `scripts/render_followup.py` | [catalog-followup](references/catalog-followup.md) |
| FAR PO / 中英采购合同 | `scripts/render_po.py` | [catalog-purchase-order](references/catalog-purchase-order.md) |
| 不报关 / 出口 / 进口 / 国内送货 | `scripts/render_shipping.py` | [catalog-shipping-customs](references/catalog-shipping-customs.md) |
| 对冲结算书 | `scripts/render_hedge.py` | 下文「已实现：对冲结算」 |

共享工具：`scripts/xlsx_common.py`（merge-safe 写格、插删行）。回归：`scripts/test_render_all_docs.py` + `test_render_jp_invoice.py`。

### 单据目录（选单）

| 族 | 何时打开分册 | 分册 |
|----|--------------|------|
| 请款 / 报价 / 手续费 | PI、請求書、見積、竹菱 PI、取扱手数料 | [references/catalog-followup.md](references/catalog-followup.md) |
| 报关 / 物流 | 出口·进口·不报关、国内送货单 | [references/catalog-shipping-customs.md](references/catalog-shipping-customs.md) |
| 采购订单 / 合同 | FAR PO、中英采购合同 | [references/catalog-purchase-order.md](references/catalog-purchase-order.md) |

定类型时**只读对应分册的路由表**，不要把分册规则抄进对话或其它 skill。

---

## 已实现：美金请款发票 PI（USD Proforma Invoice）

一张 PI = 一个**客户订单编号**下的所有货品行。只处理 **USD** 单（JPY 单走日本請求書，**禁止**用本节脚本硬套）。

### 1) 读单 + 组装 context

    python3 .agents/skills/procurement-doc-export/scripts/build_pi_context.py --order <客户订单编号>

按订单编号从飞书「客户订单审批」表读该单全部货品行，配 `customers.json` 的客户抬头，输出 context JSON（客户/货品行/单价/条件）到 stdout。客户未命中抬头库会在 stderr 警告并把地址留空（不虚构）。读数据依赖本机 lark-cli 已 `--as user` 授权。

### 2) markdown 预览 = 生成前确认（不另出文件）

把 context 里的**客户 + 货品行**用 markdown 直接在对话里渲染出来（标题 + 表格：序号/料号/数量/单价/金额），让用户先看清内容，问一句“确认就生成可编辑发票？”。**确认后**再进第 3 步。金额=单价×数量、合计手工计算给用户看即可（Excel 里由公式自动算）。

### 3) 生成 Excel（render_pi.py）

    python3 .agents/skills/procurement-doc-export/scripts/build_pi_context.py --order <订单号> \
      | uv run --with openpyxl python3 .agents/skills/procurement-doc-export/scripts/render_pi.py \
          --template procurement-skills/procurement-doc-export/templates/美金请款发票模板PI.xlsx \
          --out "PI_<订单号>.xlsx"

模板自带公式（金额=单价×数量、合计 SUM），**只填 料号/数量/描述/单价**，金额合计由表格自动计算。货品行数不固定已处理（插行/删行 + 合并单元格 + 公式范围顺延）。`--out` 写到会话工作区。

### 4) 交付给用户

**飞书发文件（机器人身份，已验证可用）：**

    lark-cli im +messages-send --as bot --user-id <用户 open_id> --file "PI_<订单号>.xlsx"

（群里用 `--chat-id <当前会话 chat_id>`；`--file` 要 cwd 相对路径。）机器人会把 .xlsx 上传发给用户，飞书原生预览 + 下载。
**网页端**：文件在会话工作区，可下载到本地用 Excel 打开（.xlsx 网页内不预览成品，故第 2 步给了 markdown 预览）。

---

## 已实现：日本請求書（イノ間請求書 / JPY）

FAR ↔ 印诺日本之间的 **JPY 请款**。模板 `templates/followup/jp-ino-invoice/blank.xlsx`（sheet「样板」）。**独立脚本，禁止调用 `render_pi.py` / 美金 PI 模板。**

### 1) 组装 context（JSON）

飞书拉单可手写或脚本拼装。最小 shape：

```json
{
  "invoice_no": "OD20260706341",
  "invoice_date": "2026-07-07",
  "subject": "電子部品の緊急調達",
  "fx_rmb": 22.5,
  "fx_usd": 160.0,
  "items": [
    {"part": "MPN-1", "qty": 5, "unit_price_rmb": 590, "unit_price_usd": null, "unit_price_jpy": null}
  ],
  "shipping": {"qty": 1, "unit_price_rmb": 72},
  "import_tax_jpy": 0
}
```

单价三选一（或组合）：`unit_price_rmb`（S 列）/ `unit_price_usd`（T）/ `unit_price_jpy`（U）；数量写 `qty`（R 列）。金额/合计由模板公式算。`build_pi_context.py` **只服务美金 PI**；JPY 订单被它拒绝时改走本节。

### 2) markdown 预览确认

同 PI：在对话里列出番号・日期・料号/数量/仕入单价，确认后再生成。

### 3) 生成 Excel（render_jp_invoice.py）

```bash
uv run --with openpyxl python3 .agents/skills/procurement-doc-export/scripts/render_jp_invoice.py \
  --template procurement-skills/procurement-doc-export/templates/followup/jp-ino-invoice/blank.xlsx \
  --out "JP_<番号>.xlsx" \
  --data ctx.json
# 或: ... render_jp_invoice.py --template ... --out ...  < ctx.json
```

货品行可多可少（默认 blank 3 槽，会插行/删行并处理合并区）。FAR 手数料/利益分配公式留在模板侧。

### 4) 交付

同 PI：飞书 `lark-cli im +messages-send --as bot --file ...` 或工作区下载。

自动化测试：`scripts/test_render_jp_invoice.py`（直接驱动 blank + 本脚本）。

---

## 已实现：跟单其余（見積 / 竹菱 PI / 取扱手数料）

统一入口 `scripts/render_followup.py --kind quotation|takebishi-pi|takebishi-fee`。blank 与字段见 [catalog-followup](references/catalog-followup.md)。**禁止**套用 `render_pi.py`。

```bash
uv run --with openpyxl python3 scripts/render_followup.py \
  --kind quotation \
  --template templates/followup/quotation/blank.xlsx \
  --out out.xlsx --data ctx.json
```

最小 context 形状：`items: [{part, qty, price, ...}]`；quotation 可加 `date`/`to`/`currency`；takebishi-pi 可加 `invoice_no`/`invoice_date`/`po_number`；takebishi-fee 可加 `invoice_no`/`invoice_date`/`subject`。

---

## 已实现：采购订单 / 合同

统一入口 `scripts/render_po.py --kind far|sz-ino-contract-zh|ino-contract-en`。见 [catalog-purchase-order](references/catalog-purchase-order.md)。

- `sz-ino-contract-zh`：`tax_mode: inclusive|exclusive` → 税率行与单价列头。
- `ino-contract-en`：`ship_to_mode: japan|shenzhen` → Ship to / Bill to / 抬头。

```bash
uv run --with openpyxl python3 scripts/render_po.py \
  --kind far --template templates/purchase-order/far/blank.xlsx \
  --out out.xlsx --data ctx.json
```

---

## 已实现：报关 / 物流

统一入口 `scripts/render_shipping.py --kind no-declaration|export-declaration|import-declaration|domestic-delivery`。见 [catalog-shipping-customs](references/catalog-shipping-customs.md)。

- 出口：`currency_set: cny|usd|jpy1039` 选 sheet 套；填 **汇总** + 该套主业务表货品行（cny→`出口发票`/`出口合同`；usd→`（美）出口装箱单 `；1039→`1039发票`）。报关单/申报要素等其余子表细坐标尚未全铺。
- **禁止虚构** HS / 毛净重 / 件数；缺则留空。

```bash
uv run --with openpyxl python3 scripts/render_shipping.py \
  --kind no-declaration \
  --template templates/shipping-customs/no-declaration/blank.xlsx \
  --out out.xlsx --data ctx.json
```

---

## 已实现：对冲结算

`scripts/render_hedge.py` + `templates/INO_SA_应收应付双凯杰对冲结算书模板.xlsx`。

```bash
uv run --with openpyxl python3 scripts/render_hedge.py \
  --template templates/INO_SA_应收应付双凯杰对冲结算书模板.xlsx \
  --out out.xlsx --data ctx.json
```

context：`order_no`/`order_date`/`party_b`/…；可选 `purchase_lines`（采购 sheet：D/E/F=型号/数量/采购价）、`sales_lines`（销售 sheet：G/H/I=型号/数量/单价）。金额条款句（应收/应付/轧差）仅在 context 提供 `receivable_cn`/`payable_cn`/`net_cn` 时写入，不自动推算。

---

## 数据来源（飞书 Base）

主库**「紧急调度客户需求项目管理表20251011」** base-token `EWoFbgsDxaBA8LsLxWrce74tnPc`：

- **客户订单审批** `tbldjCzwLk7qBWuv` —— 订单货品行：客户订单编号 / 客户全称 / 下单型号 / 数量 / 单价 / 币种 / 计量单位 / 交易条件。**一张 PI = 同一客户订单编号的所有行**；单价就在本表（不用另查报价）。
- 币种字段：**USD → 美金 PI；JPY → 日本請求書**。
- 同库还有 业务报价计算 / 订单记录 / 发货出库表(收货地址多为空) / 物流-出口申报方式(报关规则) / 每日汇率 / 国际运费，做报关/其它单据时会用到。

读取用 `lark-cli --format json base +record-list --as user --base-token <bt> --table-id <tid> --limit 200 --field-id <字段>...`（飞书 filter-json 形状不稳，**拉全量在本地按订单编号过滤**最稳妥）。

## customers.json（客户抬头库）

客户 → Bill To/Ship To 固定抬头（name/address/tel）。匹配：订单「客户全称」（如「たけびし高倉」）若**包含**某 key（たけびし）→ 取该抬头，余下部分（高倉）当联系人拼入电话字段（「075-… 高倉様」）。
**目前只录入了 TAKEBISHI；其他客户（パルス電子、コシダテック等）的地址/电话需业务提供后补进去**。未命中时如实告诉用户“这个客户的收件抬头还没录进系统，需要补一下”，不要虚构地址。本文件含真实客户数据，已 `.gitignore`，只在本地/服务器。

---

## Roadmap

**已完成（blank → render 脚本 + 单测）：**

- 美金 PI（`render_pi.py` + `build_pi_context.py`）
- 日本請求書（`render_jp_invoice.py`）
- 見積 / 竹菱 PI / 取扱手数料（`render_followup.py`）
- FAR / 中英采购合同（`render_po.py`）
- 不报关 / 出口 / 进口 / 国内送货（`render_shipping.py`；出口子表仍以 汇总 为主）
- 对冲结算（`render_hedge.py`）

**仍待加深（勿假装已全自动）：**

1. **飞书 context 组装** — 除美金 PI 外，其余单据尚无 `build_*_context.py`；需 JSON/人工拼装 + 预览确认
2. **出口报关子表全量 cell-map** — 合同/发票/装箱/申报要素等 sheet 细填
3. **PI 描述列** — 物料名称为空时从业务报价计算补品牌（可选）
4. **生产** — craft 用户 lark-cli user 授权；customers.json 扩录
5. **singlewindow 门户** — 人工，不做

## 输出语气（面向非技术用户）

只说“生成了什么单据、含哪些内容、怎么取”，**不出现脚本、openpyxl、lark-cli、命令、token、字段 ID 等技术名词或工具名**。数据没读到 / 客户抬头缺要**如实说**（“没查到这个订单号”“这个客户的收件抬头还没录进系统，需要补一下”），不要用模糊话搪塞，也不要虚构地址金额。

## 边界

- 只**按模板出单据**，不改订单表、不做财务/采购判断、不自动下单缴税。
- 模板版式以业务给的为准，本 skill 只把数据填进去。
- 单价/客户/数量一律以飞书表为准；生成失败（订单查无、客户未命中、依赖缺、币种不符）如实报告，不假装成功。
- 贸易单据是 Excel 表单模板，按单据选 **对应** openpyxl 填格脚本（坐标映射，不是占位符模板）。JPY 禁止套用 `render_pi.py`。

## Rationalization Table

| Excuse | Reality |
|---|---|
| “用户要单据，我直接生成文件，不用预览。” | 必须先给 markdown 预览并确认，再生成可编辑文件。 |
| “客户抬头缺失，我先编一个地址占位。” | 客户抬头未命中就如实说需要补充，不能虚构。 |
| “PDF 更方便发给人。” | 交付可编辑文件，模板本身是可再改的业务单据。 |
| “模板差不多，我可以改版式适配数据。” | 模板版式以业务给的为准，只把数据填进去。 |
| “JPY 单用 render_pi / 美金模板改改就行。” | 日本請求書用 `render_jp_invoice.py` + jp-ino blank；硬套 PI 是错路。 |
| “出口报关汇总填了就等于全套报关文件齐了。” | 出口子表细坐标未全铺；缺 HS/重量等必须标缺，不编。 |
| “没有 build_*_context 就跳过预览直接出 xlsx。” | 仍须 markdown 预览确认；缺飞书组装就用手写 JSON。 |
