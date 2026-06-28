# 硬盘候选生成

适用：企业 HDD、NAS HDD、监控/渠道 HDD、2.5/3.5 inch SATA/SAS 硬盘。

## 必须抽取

- 容量、形态、接口、转速、sector format、缓存或性能档。
- 企业盘 / NAS / surveillance / desktop 等产品线定位。
- 工作负载等级、可靠性指标、功耗、加密/安全擦除等功能后缀。

## 候选顺序

1. 原厂 replacement / successor / superseded-by / PCN。
2. 同厂同容量同接口当前产品线；不要限制在同一个 family name。
3. 同厂渠道线、NAS 线、enterprise 近邻系列。
4. 跨品牌同容量同接口同形态候选。
5. 只作为降级的容量/转速/sector format 不完全一致候选。

## 查询词

- `"<MPN>" replacement successor superseded`
- `"<MPN>" cross reference equivalent`
- `"<vendor>" "<capacity>" "<interface>" "<rpm>" HDD alternative`
- `"<vendor>" "<capacity>" "<interface>" NAS enterprise HDD model`
- `"<base series>" ordering information model table`
- `"<vendor>" "<capacity>" "<interface>" "<rpm>" channel NAS HDD model`
- `"<vendor>" "<capacity>" enterprise channel HDD model`
- `"<old MPN>" "<candidate MPN>"`

## 候选生成细节

- 企业盘不能只停在同系列安全/接口/容量变体和跨品牌泛等效；生成候选时必须补同厂同容量同接口的渠道线、NAS 线和近邻产品线。
- HDD 要同时扩展 enterprise、NAS/channel、surveillance/desktop 等近邻产品线；企业盘输入也可能有同厂 NAS/渠道盘候选。
- 跨产品线时先核对容量、SATA/SAS、3.5 inch、转速、sector format、workload，再决定是否列为 `param_compatible`；不要因 family 名不同直接排除。
- 不要因为已有同系列安全功能后缀（SIE/SED）候选就收口；硬盘业务确认替代可能是同厂另一产品线的同容量型号。
