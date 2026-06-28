# 电容候选生成

适用：薄膜电容、安规电容、MLCC、铝电解和带认证/包装后缀的被动电容。

## 必须抽取

- 电容值、电压、容差、介质、安规等级。
- 脚距、封装/尺寸、温度、寿命、认证。
- 基础料号、包装后缀、认证后缀。

## 候选顺序

1. 同基础料号的订货/包装/认证后缀。
2. 原厂 successor / ordering information 中的当前 OPN。
3. 同厂同系列同参数候选。
4. 跨品牌同参数候选。

## 查询词

- `"<MPN>" capacitor replacement successor`
- `"<base MPN>" ordering information`
- `"<capacitance>" "<voltage>" "<safety class>" capacitor equivalent`
- `"<series>" "<capacitance code>" part numbering`
- `"<base MPN>" "<base MPN><suffix>" datasheet`
- `"<hyphenated MPN>" "<base MPN><suffix>" ordering`
- `"<series>" "<capacitance code>" "<safety voltage>" "<lead pitch>" "<safety class>"`
- `"<capacitance>" "<safety voltage>" "<safety class>" "<lead pitch>" "<tolerance>" film capacitor`

## 候选生成细节

- 被动电容要先查基础料号的订货/包装/认证后缀；不要直接跳到跨品牌泛参数。
- 同系列电容要同时搜索无连字符、带连字符、带尾缀三种 OPN 写法。
- X2 薄膜电容的候选生成键：电容值代码、安全电压或更高等级、容差、脚距、介质、径向引线和认证。
- 跨品牌候选必须逐项匹配这些键；电压更高通常可接受，容差从 `±10%` 放宽到 `±20%` 应标成 `downgrade`。
- 同基础料号候选无库存也不要丢弃；替代判断优先是 OPN/规格关系，不是库存关系。
