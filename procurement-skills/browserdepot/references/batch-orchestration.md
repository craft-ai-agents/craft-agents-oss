# 配方:批量多型号编排

消费 skill:`procurement-batch-orchestration`(子会话编排、汇总表、判断标准都在它那,本节不重复)。

## 两种批量方式

1. **一次多型号**(简单批量):browserdepot 原生支持逗号分隔多 parts,一个 job 覆盖全部型号 × 全部 direct 源。

   ```bash
   browserdepot submit --parts "<型号1>,<型号2>,<型号3>"
   browserdepot wait <job_id> --timeout 600
   browserdepot results <job_id>
   ```

2. **子会话编排**(每型号独立走完整找料流程):batch-orchestration 按型号派子会话,每个子会话按 `procurement-platform-search`(→ 本 skill)取证。**子会话的完整度/超时恢复规则由那两个 skill 定义,本配方不重复、它们改了也不用同步。**

## 边界

批量不改覆盖口径:仍按每型号的 direct 全量验收(每源落状态),不因为是子任务就抄近路。
