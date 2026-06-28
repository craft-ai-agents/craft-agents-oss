---
name: procurement-doc-export
description: 把飞书里的订单/表格数据，按业务给的模板，生成可编辑的贸易/财务单据（Excel/Word）给用户下载或发飞书。当用户说“开请款发票/生成 PI/把这单导出成发票/请款单/对账单/报关资料”“按模板出单据”时使用。已实现：美金请款发票 PI（USD）；其余模板(日本請求書/对冲结算/出口进口报关)按同机制逐个补。
metadata:
  short-description: 按模板生成贸易/财务单据
  lang: zh
---

# 按模板生成贸易/财务单据

把飞书订单数据，按业务给的模板，生成**可编辑单据**（请款发票、报关资料等）给采购/业务，下载或直接发飞书。给可编辑文件（不是 PDF）是为了让人能再改。模板在本 skill `templates/`（含真实客户/财务数据，只在本地、不进仓库）。

通用流程：**读数据 → markdown 预览(=确认) → 按模板生成文件 → 交付**。下面以已实现的 PI 为样板，其它单据参照同一机制。

---

## 已实现：美金请款发票 PI（USD Proforma Invoice）

一张 PI = 一个**客户订单编号**下的所有货品行。只处理 **USD** 单（JPY 单走日本請求書，见 roadmap）。

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

## Roadmap（按同机制逐个补，别一次全上）

- **日本請求書（JPY 单）**：模板 `INO_SA_日本印诺请款模板.xlsx`，机制同 PI（读同一订单表、按币种 JPY 筛）。
- **对冲结算书** `INO_SA_应收应付双凯杰对冲结算书模板.xlsx`：带采购/销售明细两表。
- **出口/进口报关那套**（重，十几 sheet）：用 PI/发票做资料 → 生成 报关单/合同/发票/装箱单/申报要素。HS 编码优先查模板自带「清关HS」表（连接器 8536…/IC 8542… 常用料免现查），真要现查再去 `wmsw.mofcom.gov.cn`（可采集）。门户操作（singlewindow 委托/缴税/下载放行）是**人工**，不做。
- **PI 描述列**：现在订单表「物料名称」常为空导致 Desc 空；可后续从「业务报价计算」的品牌字段补。
- **生产部署**：服务器（craft 用户）的 lark-cli 要同样做 user 身份授权（im:chat:read、drive:file:download、base/sheets/docx readonly），PI 才能在线上跑（本机已授权，服务器未做）。

## 输出语气（面向非技术用户）

只说“生成了什么单据、含哪些内容、怎么取”，**不出现脚本、openpyxl、lark-cli、命令、token、字段 ID 等技术名词或工具名**。数据没读到 / 客户抬头缺要**如实说**（“没查到这个订单号”“这个客户的收件抬头还没录进系统，需要补一下”），不要用模糊话搪塞，也不要虚构地址金额。

## 反合理化表格

| 常见借口 | 反驳 |
|---|---|
| “用户要单据，我直接生成文件，不用预览。” | 必须先给 markdown 预览并确认，再生成可编辑文件。 |
| “客户抬头缺失，我先编一个地址占位。” | 客户抬头未命中就如实说需要补充，不能虚构。 |
| “PDF 更方便发给人。” | 交付可编辑文件，模板本身是可再改的业务单据。 |
| “模板差不多，我可以改版式适配数据。” | 模板版式以业务给的为准，只把数据填进去。 |

## 边界

- 只**按模板出单据**，不改订单表、不做财务/采购判断、不自动下单缴税。
- 模板版式以业务给的为准，本 skill 只把数据填进去。
- 单价/客户/数量一律以飞书表为准；生成失败（订单查无、客户未命中、依赖缺、币种不符）如实报告，不假装成功。
- 贸易单据目前都是 Excel 模板，走 `render_pi.py` 这类 openpyxl 填格脚本（按单元格坐标填，不是占位符模板）。
