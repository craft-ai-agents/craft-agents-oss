# 模板目录

业务 Excel 表单模板（空白 + 历史扁平名）。**所有 `*.xlsx` / `*.pdf` 已 gitignore**，只在本地/服务器。

填充方式：openpyxl **按单元格坐标**写可变字段（`../scripts/xlsx_common.py` + 各 `render_*.py`），不是 Jinja 占位符。

## 目录布局（2026-07 从三份 zip 收编）

| 族 | 路径 | 脚本 | 分册 |
|----|------|------|------|
| 物流/报关 | `shipping-customs/*/blank.xlsx` | `render_shipping.py` | [catalog-shipping-customs](../references/catalog-shipping-customs.md) |
| 跟单 | `followup/*/blank.xlsx` | `render_followup.py` / `render_jp_invoice.py` | [catalog-followup](../references/catalog-followup.md) |
| 采购订单 | `purchase-order/*/blank.xlsx` | `render_po.py` | [catalog-purchase-order](../references/catalog-purchase-order.md) |
| 美金 PI | `美金请款发票模板PI.xlsx` | `render_pi.py` | SKILL.md |
| 对冲结算 | `INO_SA_应收应付双凯杰对冲结算书模板.xlsx` | `render_hedge.py` | SKILL.md |

样本（对照填格，**禁止当输出底稿**）：`../samples/<族>/`。

## 旧扁平名（兼容）

- `INO_LG_不报关出口资料.xlsx` / `INO_LG_出口报关文件模板.xlsx` / `INO_LG_进口报关文件模板.xlsx`
- `INO_SA_日本印诺请款模板.xlsx` / `INO_SA_应收应付双凯杰对冲结算书模板.xlsx`
- `美金请款发票模板PI.xlsx`

新路径优先 `*/blank.xlsx`；旧名可逐步 deprecate。

## 规则

- 只复制 blank 再填数；不要用样本文件另存为交付物。
- 版式/公式/条款锁死；插行处理合并区（`xlsx_common.adjust_item_block`）。
