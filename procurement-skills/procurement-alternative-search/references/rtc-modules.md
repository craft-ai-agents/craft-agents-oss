# RTC 和模块类候选生成

适用：RTC、晶振、时钟模块、带包装/环保/客户后缀的小型模块。

## 必须抽取

- 基础芯片/模块型号、封装、温度、接口、频率或电压。
- 客户后缀、包装后缀、RoHS/环保后缀、修订后缀。

## 候选顺序

1. 基础型号。
2. 同基础型号的封装/包装/RoHS 后缀。
3. 原厂当前 revision 或后继。
4. 跨品牌 pin-compatible 需要完整验证。

## 查询词

- `"<MPN>" base part number`
- `"<base>" ordering information`
- `"<base>" replacement successor`
- `"<base>" package RoHS suffix`
- `"<raw MPN>" Epson RTC ordering`
- `"<canonical base>" product number`
- `"<canonical base>" ":B" ":B0" ":B3"`
- `"<canonical base>" application manual package suffix`

## 输出规范

- 当需求要的是基础 MPN，`mpn` 输出基础型号；完整订货号或包装后缀放 reason。

## 候选生成细节

- RTC 已经查到基础型号时，不要把完整展示名、包装或 RoHS 后缀写进 `mpn` 导致精确命中失败；应先输出基础型号。
- RTC 先做基础型号归一化：去掉客户/包装后缀，保留厂商定义的 canonical base MPN。
- `L1`、`:B`、`:B0`、`:B3`、`ROHS` 是订货/包装/RoHS 后缀；候选生成时先输出基础型号，再把完整订货变体放 reason 或作为次级候选。
- RTC 跨系列候选不能盲目换 RX 系列；旧并行接口/24SSOP/内置 32.768kHz 模块需要 pinout 和接口级验证。
