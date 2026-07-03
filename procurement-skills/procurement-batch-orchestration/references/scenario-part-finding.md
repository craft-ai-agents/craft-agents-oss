# 配方:批量找料场景

这批全是"找料"(型号列表,查库存/平台报价)时,套用编排框架的具体标准。

## 子会话 prompt 要点

在 [SKILL.md](../SKILL.md) 第 3 步的子会话 prompt 模板里,`<对应业务 skill>` 填 `procurement-platform-search`(以及它引用的 `browserdepot`)。子会话按这两个 skill 自己的完整度和超时恢复规则执行——**这里不重复那些规则,它们改了这份配方也不用跟着改**;本节只提醒:批量场景下同样不能因为是子任务就抄近路,判断标准仍然是那两个 skill 自己定义的。

## 汇总表列名

`procurement-platform-search` 自己的输出是单型号的多平台总览表;批量场景要的是另一种形状——多型号的对比表,这个形状是 batch-orchestration 独有的,不在 `procurement-platform-search` 里。给采购的汇总对比表按找料场景定列:型号 / 有无货 / 哪家 / 价格 / 货期 / 提示。
