# 线材候选生成

适用：规格线、导线、电缆、热缩/航材类线材 OPN。

## 必须抽取

- 系列、AWG、颜色、额定温度/电压。
- 军标/规范、材料、屏蔽/非屏蔽。
- 包装、长度、渠道后缀。

## 候选顺序

1. 基础料号 + AWG + 颜色相同的包装/渠道后缀。
2. 原厂订货号别名或内部料号。
3. 同规范同 AWG 同颜色跨品牌候选。

## 查询词

- `"<MPN>" wire ordering information`
- `"<base>" "<AWG>" "<color>" alternate suffix`
- `"<spec>" "<AWG>" wire equivalent`
- `"<base without suffix>" "<vendor>" hook-up wire`
- `"<series>" "<AWG>" "<color>" Raychem Spec 44`
- `"M81044/12-<AWG>-<color>" hook-up wire`

## 候选生成细节

- 线材 OPN 应拆成系列、AWG、颜色和渠道/包装后缀；候选应生成同基础规格的包装/渠道后缀。
- 渠道后缀无结果时，不要停；去掉后缀查基础料号，通常能命中分销商标准订货号。
- Spec 44 / MIL 线材要主动生成军标交叉编号，例如 `M81044/12-22-0`、`81044/12-22-0`；必须由资料或平台结果确认后再进最终候选。
- 同一线材的内部订货号可以列为候选别名；reason 写明是同一产品编号映射，不要写成不同物料替代。
