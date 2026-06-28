# eMMC 候选生成

适用：eMMC BGA 存储器和带客户配置/版本后缀的 embedded storage。

## 必须抽取

- 容量、eMMC 版本、封装/ball count、速度模式。
- 温度等级、寿命等级、客户配置后缀、revision 后缀。
- 基础料号和尾部配置码的分界。

## 候选顺序

1. 同基础料号的 revision / customer-config 后缀。
2. 同厂同容量同封装当前 revision。
3. 同容量同封装跨品牌 embedded 候选。
4. 容量或封装不同的只作为 downgrade 或需确认。

## 查询词

- `"<MPN>" replacement successor`
- `"<base MPN>" ordering information`
- `"<base MPN>" datasheet revision`
- `"<capacity>" eMMC "<package>" industrial equivalent`
- `"<base MPN without config suffix>" eMMC`
- `"<base MPN>" "<config suffix>" "<revision suffix>"`

## 候选生成细节

- eMMC 应把基础料号与尾部配置/revision 后缀拆开，主动生成同基础 revision/customer-config 候选。
- 完整 OPN 无结果时逐级剥离：完整型号 -> 去最后配置码 -> 保留容量 + controller/package 基础码。
- 尾段配置码先视为 revision/customer-config；同基础、同容量、同封装、同 eMMC 版本时优先进入候选验证。
