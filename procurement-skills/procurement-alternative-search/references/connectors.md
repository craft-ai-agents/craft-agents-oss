# 连接器候选生成

适用：板对板、线对板、端子、插座和连接器 housing/contact。

## 必须抽取

- 位数、pitch、排数、端接方式、方向。
- 镀层、颜色、材料、包装后缀。
- 原厂连写和带连字符两种 OPN 写法。

## 候选顺序

1. 同厂同系列同位数的后缀变体。
2. 原厂 replacement / alternate / tooling-compatible 候选。
3. 同参数跨品牌候选，必须验证机械尺寸和 pinout。

## 查询词

- `"<MPN>" connector replacement`
- `"<MPN>" "<hyphenated form>"`
- `"<series>" "<positions>" "<pitch>" alternate`
- `"<vendor>" "<base>" ordering information`
- `"<hyphenated MPN>" "<manufacturer>" "<series>"`
- `"<series prefix>" "<positions>" "<pitch>" right angle header`
- `"<normalized MPN>" "also known as"`
- `"<family prefix>" "<position code>" connector`

## 候选生成细节

- 连接器可能同时使用连写数字和分组连字符写法；同一候选要双写法识别。
- 连接器必须同时生成无连字符数字写法、带连字符写法、带前导 0 的订货写法。
- 同 family 内先枚举相邻后缀/包装变体；只保留同位数、同 pitch、同方向且机械接口可验证的候选。
- 跨系列连接器候选必须标注需配对应线端壳体/端子；只有同 mating system、同机械接口的变体才可作为低风险候选。
