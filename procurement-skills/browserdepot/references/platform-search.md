# 配方:平台报价 / 找料

消费 skill:`procurement-platform-search`(业务话术、输出格式、覆盖验收话术都在它那,本节不重复)。

## 取证流程

```bash
# 首轮:全量直连平台(submit 默认 source_set=direct)。两段式,先展示国内快源、别干等 8 分钟
browserdepot submit --parts "<型号>"
browserdepot wait <job_id> --timeout 40        # 国内直连 + HTTP/API 源基本到齐
browserdepot results <job_id>                  # ← 先给用户看这批(标"部分,西方源在跑")
browserdepot wait <job_id> --timeout 300       # 仍未 complete 时,补等西方慢尾
browserdepot results <job_id>                  # 补全,作最终覆盖口径
```

- **先展示再补全**:第一批 `results` 立刻呈现给用户并注明"部分结果";`browserdepot status <job_id>` 判断是否已 complete。详见 SKILL「调用」。
- `results.coverage.per_source` + 每源终态 = 首轮覆盖口径(以**补全后**那次为准)。每个 direct 源都要落 ok / no_result / blocked / error(见 SKILL「覆盖口径」)。
- 消费 skill 的业务状态映射:`ok`→有结果、`no_result`→正常无匹配、`blocked`/`error`→本次未取到(**不是无货**)。
- 二轮聚合只在用户确认后:`browserdepot submit --parts "<型号>" --source-set aggregator`。聚合器的 `seller` 字段给下游真实卖家,作交叉验证,不算首轮直连覆盖。

## 边界

- 首轮不挑"核心平台"、不跑聚合器 / 替代候选源。
- 采集过程 / 技术字段不进给采购的输出——消费 skill 只消费 typed 行(型号/品牌/库存/价/MOQ/交期/链接)+ 每源状态。
