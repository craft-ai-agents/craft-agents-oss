# 软件 SKU 候选生成

适用：软件订阅、授权包、旧 SKU、产品层级迁移。

## 必须抽取

- 厂商、旧产品线、功能层级、授权模式。
- 旧 SKU、括号代码、渠道代码、当前产品线命名。

## 候选顺序

1. 同厂当前产品线。
2. migration / license successor / renewal / replacement SKU。
3. 同厂低配、同级、高配层级。
4. 跨厂竞品只能作为方案型替代。

## 查询词

- `"<old product>" "<old SKU>" successor`
- `"<vendor>" "<old product>" migration`
- `"<vendor>" endpoint essentials core enterprise product tiers`
- `"<old SKU>" license replacement renewal`
- `"<old product>" "<SKU>" "<current product line>"`
- `"<vendor>" endpoint essentials core enterprise comparison`

## 输出规范

- `mpn` 优先写公开产品层级或产品名。
- 括号 SKU、渠道代码、不可读订货码写在 reason，不要污染需要精确匹配的产品名。

## 候选生成细节

- 旧产品名带括号 SKU 时，若候选是当前公开产品层级，`mpn` 应只写公开产品层级名，SKU 或渠道代码放 reason。
- 企业软件旧 SKU 的 `mpn` 不要写成 `产品名 (SKU)`；若候选是公开产品层级，`mpn` 只写层级名，订货/渠道代码写入 reason。
- 同厂软件迁移要覆盖低配、同级、高配三层；不要只输出官方后继或最高阶产品。
- 经销商/报价站出现 `successor`、`Nachfolger`、`replaces` 时可作为迁移线索；reason 写成同厂产品线迁移线索，不要伪称原厂 PCN。
