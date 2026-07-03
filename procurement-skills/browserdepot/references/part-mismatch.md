# 配方:型号一致性 / 编号核对取证

消费 skill:`procurement-part-mismatch-review`(逐字符核对、关键规格锁定、一致性结论都在它那,本节不重复)。

## 取证

对报价型号(和需要对比的型号)跑 direct 取证,读结构化规格 + datasheet:

```bash
browserdepot submit --parts "<报价型号>[,<对比型号>]"
browserdepot wait <job_id> --timeout 300
browserdepot results <job_id> --fields mpn,brand,package,category,datasheet,description
```

- `mpn` = 平台返回型号,拿去和用户原型号**逐字符**比(后缀/温度等级/版本字母/包装),差异写清。
- 细规格(精度/温度/pin 定义)从 `datasheet` 链接打开核对;`datasheet` 为空或页面打不开就记为阻碍/需补充确认,不臆造。
- 型号是否等同、差异是否可接受,是消费 skill 的判断——browserdepot 只给证据。
