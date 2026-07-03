# 配方:替代料候选采集

消费 skill:`procurement-alternative-search`(替代判断、规格比对、可替代结论都在它那,本节不重复)。

## browserdepot 在替代料流程里给什么

**① 替代候选清单**(`--source-set alternative`)——直接拿跨厂牌替代/相似料候选:

```bash
browserdepot submit --parts "<原型号>" --source-set alternative
browserdepot wait <job_id> --timeout 300
browserdepot results <job_id>
```

- 当前 `alternative` 源集 = `ickey_replace`(云汉替代料):每个候选带 `mpn`(替代型号)+ `brand`(跨厂牌,如 CKS/中科芯)+ `stock` + `price_breaks`(¥ 阶梯)+ `description`(规格摘要,拿去和原型号比)+ `category` + `datasheet`。
- 候选是**线索**,可替代与否由消费 skill 按规格标尺判断——browserdepot 不下可替代结论。

**② 原型号规格标尺 / 候选佐证**(`direct`)——对原型号或已选候选跑一次 direct,拿封装/参数/datasheet/库存价:

```bash
browserdepot submit --parts "<原型号>[,<候选型号>]"
browserdepot wait <job_id> --timeout 300
browserdepot results <job_id> --fields mpn,brand,package,category,datasheet,description
```

## ⚠ 缺口(honest)

`alternative` 源集目前只有 `ickey_replace`(云汉,境内替代料)。旧引擎的 `octopart-alt`(Octopart/Nexar 的跨库 Similar Parts,覆盖更广)**尚未接入 browserdepot**——它是 PerimeterX + Next.js RSC flight 流解析 + 两跳导航,较复杂,待做。当前替代候选偏国内料;需要更广的国际替代池时,这一环还不全。
