# 工业存储卡候选生成

适用：工业 microSD / SD / CF / CFast 存储卡。

## 必须抽取

- 容量、形态、接口/速度等级、温度范围。
- NAND 模式：SLC / pSLC / MLC / TLC。
- 工业等级、耐久度、固定 BOM、写保护、是否带 adapter。
- 原厂系列和客户/包装后缀。

## 候选顺序

1. 同厂同基础料号后缀、温度或包装变体。
2. 同厂同容量同 NAND 模式当前系列。
3. 跨品牌工业等级同容量同形态候选。
4. 同形态、同 NAND 模式/工业等级、同或更宽温度的下一档容量候选。
5. 消费级同容量候选只能作为 downgrade。

## 查询词

- `"<MPN>" replacement successor cross reference`
- `"<capacity>" industrial microSD pSLC replacement`
- `"<capacity>" "<temperature>" industrial SD card equivalent`
- `"<vendor>" "<series>" "<capacity>" pSLC alternative`
- 搜索结果片段里出现的完整 MPN 必须再 exact 查询一次。
- `"<capacity>" "<next capacity>" industrial microSD pSLC orderable part number`
- `"pSLC" "microSDHC" "industrial" "<vendor>" part number`
- `"industrial microSD" "pSLC" "UHS-I" "<capacity>"`

## 候选生成细节

- 工业卡不能只保留同厂同基础料号后缀变体；候选池必须接收搜索片段/平台结果里的跨品牌完整 MPN，再反查规格。
- 找不到官方 successor 时，必须生成跨品牌工业卡候选，优先覆盖 Flexxon、Apacer、Swissbit、Kingston、Delkin、SanDisk Industrial、Transcend、Innodisk。
- exact 容量优先；若原容量过时或强候选不足，允许同形态、同 NAND 模式/工业等级、同或更宽温度的下一档容量进入候选，标为 `param_compatible`，并在 reason 中提示主机容量接受度需确认。
- HIDISC/日系私有品牌短料号先抽 microSDHC、容量、pSLC/industrial、温度，再用主流工业卡品牌具体 OPN 种子扩展。
- 常见种子族包括 Kingston Industrial microSD、Transcend industrial microSD、Swissbit industrial microSD、Delkin pSLC、SanDisk Industrial、Innodisk industrial microSD。
- 私有品牌或短料号命中主流工业卡 OPN 时，说明容量、工业等级、温度、pSLC/industrial 语义比型号字符串相似度更重要。
