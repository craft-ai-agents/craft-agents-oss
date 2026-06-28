# 内存模组候选生成

适用：SO-DIMM / DIMM / UDIMM / RDIMM / LRDIMM 内存模组。

## 必须抽取

- DDR 代际、容量、速度、pin 数、电压。
- ECC/Non-ECC、buffered/unbuffered、rank、x8/x16、温度等级。
- 是否工业/宽温、品牌系列、包装或渠道后缀。

## 候选顺序

1. 同厂同基础料号后缀或速度/包装变体。
2. 同 JEDEC 关键规格的原厂/工业品牌候选。
3. Transcend / Kingston / Crucial / Samsung / SK hynix / Micron / Innodisk / Apacer 等常见采购 MPN。
4. 消费通用条只能在工业/宽温要求不明确时作为 param_compatible。

## 查询词

- `"SO-DIMM" "<capacity>" "<DDR generation>" "<speed>" part number`
- `"<capacity>" "<DDR generation>" SODIMM industrial Transcend`
- `"<capacity>" "<DDR generation>" SODIMM Kingston Samsung SK hynix`
- `"<MPN>" replacement equivalent`
- `"SO-DIMM <number>" "<industrial memory vendor>"`
- `"SO-DIMM" "<industrial module MPN>"`
- `"<vendor>" "<module-series-pattern>" "SO-DIMM"`
- `"SO-DIMM" "industrial" "part number" "Transcend"`
- `"<MPN>" 後継品 生産終了 仕様 型番`

## 候选生成细节

- `SO-DIMM + 数字` 这类短名不能只解释成通用容量 + DDR 代际；短名必须按容量和工业/常见采购 MPN 扩展，不要只输出泛 JEDEC 兼容条。
- 描述型短名里的数字不要直接解释成容量或 DDR 代际；先按未知容量/未知代际的 SO-DIMM 需求处理，再用证据收敛。
- `SO-DIMM <数字>` 必须同时搜索 legacy/industrial 模组品牌和 MPN 形态，尤其工业模组厂、内存原厂和主流渠道品牌的完整订货号。
- 日系内存模组要查 `後継品`、`生産終了`、`仕様`、`型番`；`/ST`、`/RE` 这类后缀先按包装/渠道/后继变体验证。
- 同厂官方后继优先于泛 JEDEC 兼容条。
- 输入含 `SO-DIMM` 时先按内存模组处理，不要被连接器搜索结果带偏。
