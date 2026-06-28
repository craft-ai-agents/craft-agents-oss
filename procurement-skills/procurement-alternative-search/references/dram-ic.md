# DRAM 裸片候选生成

适用：Micron / Samsung / SK hynix 等 DDR、LPDDR、GDDR、DDR5 裸片。

## 必须抽取

- family prefix、density、organization、speed grade、package。
- 温度/qualification、revision suffix、packaging suffix。
- 冒号、空格和 `TR` 等尾缀的含义。

## 候选顺序

1. 完整 OPN。
2. 去包装后缀的 OPN。
3. 去 revision 后缀的基础料号。
4. density + organization + speed 的基础前缀宽搜。
5. 宽搜返回的同密度/组织/速度候选，即使中段 die/package code 变化也要进入验证。
6. 同中段代码但降速、低温度等级或其它降级候选。

## 查询词

- `"<MPN>" replacement successor`
- `"<base MPN>" "<vendor>" datasheet`
- `"<base prefix>" "<density>" "<organization>" "<speed>"`
- `"<base prefix>" ordering information`
- `"<MPN without package suffix>" revision`
- `"<base prefix>" "<die code>" "DDR5"`
- `"<density> DDR5" "<die revision>" "<organization>" "<speed>"`
- `"<MPN>" "available until stocks exhausted" "successor"`

## 候选生成细节

- LPDDR 通过修订后缀互查时，要主动生成同基础料号的前后 revision 候选。
- LPDDR 冒号后字母优先按 revision 处理；同基础料号、同 speed grade、同封装时，相邻 revision 互为高优先候选。
- 温度、车规、功能安全等等级族可以列入候选，但 reason 必须说明温度或功能差异。
- LPDDR 跨品牌通常不要默认 pin-to-pin，除非有明确 ball map/cross-reference 证据。
- 完整 OPN 查不到时，要宽搜 family prefix + density + organization；若结果出现同密度/组织/速度、但中段 die/package code 不同的候选，应进入验证，不能只保留同中段代码候选。
- 同品牌同 family、同密度/组织/速度的中段代码变化候选，排序高于同中段代码但降速的候选；降速料只能在无同速候选或用户明确接受降级时靠前。
- DDR5 裸片若原件显示停产、库存耗尽或旧 die revision，候选排序应优先同密度/组织/速度的新 die revision，高于同基础包装变体和降速料。
- 中段 die code 变化不能按字符串差异排除；先核对 density、x8/x16、speed grade、package/ballout、temperature。
- 结构化平台或 family 宽搜已经返回的同参数候选，必须进入最终替代清单；若 package/ballout 或 revision 关系未完全确认，写成 `需补充确认`，不要因为中段代码不同而静默丢弃。
- `TR` 通常是包装后缀；核心候选写裸 OPN，包装写进 reason，不要把 `TR` 当作不同电气型号。
