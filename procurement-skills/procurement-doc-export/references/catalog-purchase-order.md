# 采购订单 / 合同（purchase-order pack）

面向供应商的**采购侧**单据，不是客户请款 PI。与 PI 同属 `procurement-doc-export`：读数 → markdown 预览确认 → openpyxl 按 cell-map 填模板 → 交付可编辑 `.xlsx`。

**状态：渲染已实现** — `scripts/render_po.py --kind far|sz-ino-contract-zh|ino-contract-en`。回归：`scripts/test_render_all_docs.py`（PoRenders）。条款正文以模板为准，不另写、不改法律条款。尚无 `build_po_context`：context 用手写 JSON 或从采购侧表拼装后预览确认。

路径均相对 skill 根：`procurement-skills/procurement-doc-export/`。

---

## 1. 何时用哪张 PO

触发维度：**买方主体**、**收货仓点**、**是否含税**、**对供应商语言**。拿不准的标 **待业务确认**，不要猜。

| 场景（样本名） | 模板键 | 买方（甲方） | 语言 | 税口径 | 收货 / Ship to（样本观察） | 选用触发（当前理解） |
|---|---|---|---|---|---|---|
| FAR 未税采购订单 | `far` | 弗伊森太平洋控股有限公司 | 中文 | **未税**（列名「单价未税」） | 深圳龙光世纪大厦收货地址（模板预填） | 采购主体为 **FAR/弗伊森** 的国内向供应商订单 |
| 深圳印诺采购合同 · 含税 | `sz-ino-contract-zh` | 深圳市印诺电子科技有限公司 | 中文 | **含税**（样本：`单价(含税)` / `税率：13%增值税` 等） | 模板预填深圳收货地址 | 主体为 **深圳印诺**、对内资供应商、需增值税票/含税价 |
| 深圳印诺采购合同 · 未税 | `sz-ino-contract-zh` | 同上 | 中文 | **未税**（样本：`单价(未税)` / `税率：未税`） | 同上 | 主体深圳印诺、但本单按未税谈价 |
| 印诺合同 Eng · 寄日本仓 | `ino-contract-en` | 抬头常为 Ino Electronics（**待业务确认**与主体切换规则） | 英文 | 样本为 **USD**；海外供应商一般不走国内增值税 | Ship to：日本仓（样本：千叶野田）；Bill to：日本印诺地址 | 境外/英文供应商，货进 **日本仓** |
| 印诺合同 Eng · 寄深圳仓 | `ino-contract-en` | 抬头常为 Shenzhen Ino…（blank 默认即此） | 英文 | 同上 USD | Ship to：深圳印诺；Bill to：样本为 **F.A.R Pacific** HK 地址 | 境外/英文供应商，货进 **深圳仓** |

**粗路由（可执行，冲突时问用户）：**

1. 用户点名「FAR 单 / 弗伊森 PO」→ `far`。
2. 供应商沟通语言为中文、买方为深圳印诺 → `sz-ino-contract-zh`；再问/查 **含税还是未税**，改列头与 `税率` 文案（见 §3）。
3. 供应商侧要英文 PO → `ino-contract-en`；再问/查 **寄日本仓还是寄深圳仓**，填 Ship to / Bill to / 抬头（见样本，**不要编地址**）。
4. 主体、仓点、税口径任一未知 → **先问用户**，不默认。

**待业务确认：**

- FAR vs 深圳印诺 vs 日本印诺 的**固定切换规则**（是否与客户币种/报关链路绑定）。
- 中文合同「含税」列布局有多种历史样本（仅含税列 vs 未税+含税双列）；以当前 `blank.xlsx` 为底，差异列是否要统一。
- 英文 PO 寄日本仓时抬头 `Ino Electronics Co.,Ltd.` 与 blank 默认 `Shenzhen Ino…` 的正式切换表。
- 运费/Handling 是否固定占一行、币种是否永远只有 USD。

---

## 2. 模板与样本路径

| 键 | blank（gitignored，本地/服务器才有） | 样本目录 |
|---|---|---|
| `far` | `templates/purchase-order/far/blank.xlsx` | `samples/purchase-order/far/` |
| `sz-ino-contract-zh` | `templates/purchase-order/sz-ino-contract-zh/blank.xlsx` | `samples/purchase-order/sz-ino-contract-zh/`（含税 / 未税 / 含税2…） |
| `ino-contract-en` | `templates/purchase-order/ino-contract-en/blank.xlsx` | `samples/purchase-order/ino-contract-en/`（寄日本仓 / 寄深圳仓） |

填格时**只复制 blank**，不要拿带真供应商数据的 sample 当输出底稿。对照版式、Ship to/Bill to、含税列名时再打开 sample。

---

## 3. 填充模型

与 PI 相同机制（`scripts/xlsx_common.py` + `render_po.py`）：

- **openpyxl cell-map**：按坐标写可变格；标签、买方固定抬头、银行/开票块、**条款正文**一律不改。
- **保留公式**：行金额 `单价×数量`、小计/合计 `SUM`。
- **货品行数不固定**：`adjust_item_block` 插删行 + 合并区。
- **多 sheet**：`ino-contract-en` 有效内容在 **Sheet1**（脚本只保留该 sheet）。
- **含税/未税**：context `tax_mode: inclusive|exclusive` → A14 税率文案 + G9 单价列头。
- **英文仓点**：`ship_to_mode: japan|shenzhen` → Ship to / Bill to / 顶部抬头；地址未给时用脚本内业务默认占位句，**业务正式地址须覆盖**，禁止随意编造。

### CLI

```bash
uv run --with openpyxl python3 scripts/render_po.py \
  --kind sz-ino-contract-zh \
  --template templates/purchase-order/sz-ino-contract-zh/blank.xlsx \
  --out PO.xlsx --data ctx.json
```

**context 要点：** `po_number`, `po_date`, `supplier_name`/`supplier_contact`/`supplier_phone`/`supplier_address`, `items[{brand,part,qty,price,unit,batch,delivery,note}]`；sz 加 `tax_mode`；en 加 `ship_to_mode` 与可选 `ship_to`/`bill_to`/`currency`。

**典型可变字段（填 map 时以 blank 实测坐标为准）：**

| 区域 | 常见字段 |
|---|---|
| 头 | PO 号、订单日期、币种、运输方式、Terms、交期 |
| 供方 | 供应商全称、联系人、电话、地址 |
| 收货/账单 | 收货地址或 Ship to / Bill to |
| 行 | 品牌/品名、型号、单位、数量、批次/DC、单价、交货期、备注；可选运费行 |
| 尾 | 付款方式、税率文案、大写金额（有公式跟公式；否则按合计生成） |

条款区（「为建立甲乙双方…」「1.乙方必须保证…」及 Eng Note 1–5）= **模板固定文本**，生成器只保留。

---

## 4. 数据来源与缺口

PI 读的是飞书 **客户订单审批**（卖出侧）。**PO 是买入侧**，不能默认「同一订单号拉客户表就能出完整采购合同」。

| 需要 | 可能来源 | 现状 |
|---|---|---|
| 料号 / 数量 / 客户侧型号 | 客户订单审批、业务报价计算 | 部分可复用；采购型号可能与客户型号不同 |
| **采购单价 / 币种 / 是否含税** | 询价表、采购员谈定结果 | **缺口**：无稳定「一张 PO = 哪几行询价」的自动键 |
| **供应商主体与联系人地址** | 供应商档案（`larkdepot` / shortlist） | 档案有名称/联系方式；**完整合同地址常不全** |
| **PO 编号规则** | 业务习惯（样本见 `PO-2026-…` / `PO20251224…` 等） | **待业务确认**，勿自创规则硬写 |
| **买方主体 / 仓点** | 人工或未建配置表 | **缺口**，生成前必须明确 |
| 付款方式 / 交期 / 运费 | 常人工 | 缺则预览里标「待填」，不编 |

**诚实策略：**

- 能从表读到的只填能核对的字段；缺供应商地址、缺采购价、缺税口径 → 预览中列出缺口，请用户补或粘贴，**不虚构**。
- 在专用 `build_po_context` 落地前，允许用户提供结构化输入（markdown/JSON）或明确指定飞书表+筛选条件；仍须预览确认。
- 不要把客户 Bill To 误写成供应商抬头；不要把销售单价当采购单价。

---

## 5. 流程与边界

**流程（对齐 PI）：**

1. 判定模板键 + 税口径/仓点（§1）。
2. 组装 context → **markdown 预览**（买方、供应商、仓点、税、行项目、合计）。
3. 用户确认后生成 `.xlsx`。
4. 交付：会话下载或飞书发**当前用户**（与 PI 相同通道）。

**边界：**

- 只出**可编辑 xlsx**；不转 PDF、不做扫描件、不嵌入公章图片「自动盖章」。
- **不自动**向供应商邮箱发 PO；用户要发邮件时，只给文件，由人确认后再发。
- 不改飞书采购/订单表、不代下单、不代付款。
- 不修改模板条款正文；不发明合同条款或质保年限。
- 版式以 blank 为准；不为了塞数据改版式。
- 生成失败（模板缺失、关键字段空、主体不明）如实说，不假装已下单。

面向用户时仍用业务语言（「FAR 未税采购单」「深圳印诺含税合同」「英文 PO 寄日本仓」），不暴露 openpyxl/路径/token。

---

## 6. Rationalization Table

| Excuse | Reality |
|---|---|
| 「客户订单审批有型号数量，直接开 PO。」 | PO 还要采购价、供应商、买方主体、仓点、税口径；缺一不可就问，不硬出。 |
| 「含税未税差不多，统一写成含税。」 | 列头与税率文案必须与谈价一致；错了影响开票与付款。 |
| 「英文 PO 寄哪仓不清楚，两个地址都写上。」 | 日本仓与深圳仓 Ship to/Bill to 不同；不明就问。 |
| 「条款我按常识改严一点。」 | 条款锁定在模板里；只填数据格。 |
| 「生成后直接邮件发给供应商并盖章。」 | 只交付可编辑 xlsx 给用户；盖章与外发须人确认。 |
| 「供应商地址档案没有，我按官网编一个。」 | 地址缺失就说缺失；不虚构。 |
| 「金额我算死数写进去，公式不要了。」 | 有公式就保留；合计交给表格。 |
| 「FAR 和印诺模板混用，反正都是采购单。」 | 买方主体不同，模板与开票信息不同，禁止混用。 |

---

## 7. 与 PI 的差异一览

| | 美金 PI | 本 pack（已实现 render） |
|---|---|---|
| 方向 | 向客户请款 | 向供应商下单/签合同 |
| 主数据 | 客户订单审批 + customers.json | 采购侧订单/询价 + 供应商信息（缺口见 §4；尚无 build_po_context） |
| 模板 | `templates/美金请款发票模板PI.xlsx` | `templates/purchase-order/{far,sz-ino-contract-zh,ino-contract-en}/blank.xlsx` |
| 脚本 | `render_pi.py` | `render_po.py` |
| 分支 | 币种 USD | 主体 × 税 × 仓点 × 语言 |
