# 工业自动化模块候选生成

适用：PLC 模块、通信模块、I/O 扩展、工业控制配件。

## 必须抽取

- 厂商、PLC 系列、功能协议、安装/扩展总线。
- I/O 或通信功能、软件/固件依赖、生命周期。

## 候选顺序

1. 原厂 old/new model、predecessor/successor。
2. 同 PLC 系列同功能模块。
3. 功能覆盖但接口或安装不同的候选标为需确认。

## 查询词

- `"<MPN>" successor predecessor replacement`
- `"<vendor>" "<PLC series>" "<function>" module`
- `"<MPN>" manual replacement`
- `"<MPN>" "MELSEC iQ-F" "Network/Communication module"`
- `"<MPN>" Mitsubishi Electric discontinued replacement`
- `"MELSEC iQ-F" "<protocol>" module "<MPN>"`
- `"<old MPN>" "<new MPN>" specifications`

## 候选生成细节

- 工控模块要找同厂同 PLC 系列同功能模块的当前/前代命名，不能只按协议名泛搜。
- 工控模块优先查原厂 discontinued / alternative models 页面；短名容易被搜索误判时，强制加厂商、PLC 系列和模块功能词。
- 原厂替代表要按方向读取：如果表明旧型号 discontinued，replacement 是新型号，则输入新型号时反向使用旧型号只能作为前代/降级兼容候选。
- 工业自动化模块不能只看协议名相同；reason 需要比较 PLC 系列、扩展总线、端口数、供电、Class 1/3 连接能力、PPS、client/tag communication。
