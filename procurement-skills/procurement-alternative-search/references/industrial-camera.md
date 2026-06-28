# 工业相机候选生成

适用：工业相机、机器视觉相机、同厂型号迭代。

## 必须抽取

- 厂商、接口、传感器、分辨率、帧率。
- 彩色/黑白、外形尺寸、镜头座、触发/I/O、生命周期。

## 候选顺序

1. 原厂产品页标注的 alternative product。
2. 同厂同传感器或同分辨率同接口后继。
3. 跨品牌同传感器候选，需验证机械和软件兼容。

## 查询词

- `"<MPN>" "alternative product"`
- `"<MPN>" discontinued replacement`
- `"<vendor>" "<resolution>" "<interface>" camera successor`
- `"<MPN>" "<article no>" Baumer industrial camera`
- `"<MPN>" "<candidate MPN>" Baumer`
- `"<sensor>" "<resolution>" "<interface>" "<vendor>" camera`

## 候选生成细节

- 工业相机应优先生成同厂同分辨率/同传感器/同接口的代际后继，不要只按泛相机规格找跨品牌替代。
- 工业相机短系列名不要按晶振/振荡器处理；看到 article number 或相机系列格式，应先判为工业相机。
- 工业相机优先查厂商产品页的 `Alternative product` 字段；明确写出同厂后继时，排在跨品牌同传感器候选之前。
- 同厂新一代系列是高优先候选；验证时比较 article number、传感器、分辨率、帧率、接口、镜头座、机身尺寸、I/O 接口和 SDK 兼容性。
- 输入带 article no. 时，把 article no. 作为强消歧词。
