# 继电器候选生成

适用：信号继电器、功率继电器、机电开关类。

## 必须抽取

- 线圈电压、触点形式、触点负载、端子和安装方式。
- 密封/可清洗、尺寸、系列、后缀含义。
- 生命周期和原厂 PCN/EOL 信息。

## 候选顺序

1. 原厂 PCN/EOL recommended replacement。
2. 同线圈电压和触点形式的官方后继系列。
3. 同系列后缀变体。
4. 跨品牌 pin-compatible 仅在规格完整时列。

## 查询词

- `"<MPN>" relay replacement PCN`
- `"<series>" relay recommended replacement`
- `"<coil voltage>" "<contact form>" relay cross reference`
- `"<normalized MPN>" product obsolescence recommended replacement`
- `"<series>" discontinuation suggested replacement relay`
- `"<old series>" "<coil voltage>" PCN`

## 候选生成细节

- 继电器要主动查原厂停产替代和同线圈触点配置，不能只列同系列后缀变体。
- 先规范化继电器写法：连续写法、分段连字符写法、密封/端子/包装后缀写法都要生成并反查。
- PCN 明确给出建议替代时，即使不是 pin-to-pin 也要列入；`type` 应按差异降为 `param_compatible` 或 `downgrade`，reason 写清 PCB footprint、触点形式或尺寸差异。
- 如果 PCN 同时写 `no direct replacement` 和 `suggested replacement`，不能因为不是直插就丢掉建议替代。
