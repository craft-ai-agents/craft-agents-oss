# 压敏电阻候选生成

适用：MOV / ZNR / surge absorber 压敏电阻。

## 必须抽取

- 盘径、压敏电压、最大 AC/DC 工作电压、钳位电压。
- 浪涌电流、能量、引线间距、温度、认证。
- 系列前缀和包装/引线成形后缀。

## 候选顺序

1. 原厂 replacement / successor / cross-reference。
2. 同厂新系列或后缀变体。
3. 按盘径 + 电压等级生成 TDK/EPCOS `B722` Standard 和 AdvanceD、Littelfuse `VxxZA/VxxZT`、Panasonic `ERZ-E/ERZ-V` 等候选。
4. 只保留反查后关键参数一致的候选。

## 查询词

- `"<MPN>" varistor cross reference equivalent`
- `"<varistor voltage>" "<disc size>mm" MOV cross reference`
- `"<AC voltage>" "<disc size>mm" B722 K101`
- `"<MPN>" Panasonic TDK EPCOS equivalent`
- `"<MPN>" "NEW SMALLER VERSION" varistor`
- `"<MPN>" "B722" "StandarD" varistor`
- `"B722<disc>S0<voltage-code>K101" TDK "<disc size>mm"`
- `"B722<disc>S2<voltage-code>K101" TDK "<disc size>mm"`
- `"<disc size>mm" "<varistor voltage>" "Standard" "AdvanceD"`
- `"<MPN>" "S0" "S2" EPCOS TDK varistor`

## 候选生成细节

- Panasonic ZNR 不能只找同厂同系列或接近 TDK 码；要系统生成并验证按盘径和电压参数匹配的 TDK/EPCOS 候选。
- 不要把 Panasonic 的电压代码直接映射成 TDK 同数字字段；跨品牌要按真实电压参数和盘径生成候选，再逐项验证。
- TDK/EPCOS `B722` 候选要同时生成 Standard `S0<voltage-code>K101` 和 AdvanceD `S2<voltage-code>K101`；很多精确订货候选在 Standard，不能只试 AdvanceD。
- 小盘径、中盘径和大盘径都要按各自盘径生成完整订货号；不要只试相邻电压等级或只试高浪涌版本。
- AdvanceD/高浪涌候选可以作为增强候选，但不能替代 Standard 候选的检查。
- 通过短型号找 TDK 时，常会返回 AdvanceD；还要反查完整 Standard 订货号。
- Panasonic E 系列作为同厂迁移候选；找到 `NEW SMALLER VERSION` 也要继续生成 TDK/EPCOS、Littelfuse、Bourns 候选。
- 5mm 小盘径 Littelfuse `V330ZA05(P)` 这类候选可能浪涌电流低于原件，需标成 `downgrade`。
