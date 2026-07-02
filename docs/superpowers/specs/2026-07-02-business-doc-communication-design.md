# 采购业务文档双向沟通设计

## 问题

采购业务规则(找料流程、库存判断、替代料标准等)都写死在 `procurement-skills/*/SKILL.md` 里——纯技术文档,面向 agent,不面向天天用这个工具的采购人员。改 skill 时业务方完全看不到发生了什么变化,业务方想对某个业务判断提建议(比如"库存查不到应该怎么提示我"),也没有反馈渠道,只能口头说,容易丢。

## 决策

建一份**飞书总文档**(叙事体,一份文档、按 skill 分章节),用业务语言描述每个 skill 现在的业务行为——不是 SKILL.md 原文,是翻译版:去掉工具名/脚本/命令/接口这类技术细节,只留"输入什么、按什么规则判断、输出给你看什么"。文档自带飞书评论功能,采购人员(即日常用 agent 找料/查库存的那批人本人)可以直接在对应章节下评论提建议,双向沟通落在这一份文档里。

**覆盖范围**:面向采购人员的 9 个业务 skill——`procurement-platform-search`、`procurement-alternative-search`、`procurement-local-inventory-lookup`、`procurement-supplier-shortlist`、`procurement-model-info-search`、`procurement-part-mismatch-review`、`procurement-doc-export`、`procurement-feishu-table-fill`、`procurement-batch-orchestration`。不含 `scrape-engine`/`feishu-db`/`cloakbrowser`——这三个是纯基础设施,采购人员不会直接感知或对它们提"业务流程"建议,它们的行为已经通过上面 9 个 skill 的章节间接体现。

**同步机制**(翻译这步需要判断力,不能全自动,只自动化"提醒过期"):

- `docs/business-doc-sync-manifest.json`:记录每个 skill 上次同步进飞书文档时,对应 `SKILL.md` 所在的 git commit SHA。
- `scripts/check-business-doc-sync.sh`:对每个 skill,比较其 `SKILL.md` 当前所在的最新 commit 与 manifest 里记的 SHA;不一致就报告"这个 skill 的业务文档可能过期,需要人工核对是否要更新对应章节"。
- 两者都放在仓库里**不会被部署到生产**的位置(`docs/`、`scripts/`),不进 `procurement-skills/`——那个目录整体会被 rsync 镜像到生产采购 agent,混进去的话会变成对采购人员"可见"的多余内容。
- 脚本只负责检测和提醒,不负责生成或推送内容——决定要不要更新、怎么翻译成业务语言,仍然是人(或未来某次带着判断力的会话)来做。

## 非目标

- 不做全自动同步(自动翻译 + 自动推送飞书)——翻译成业务语言需要判断,勉强自动化反而可能产出业务方看不懂或不准确的内容。
- 不覆盖纯基础设施 skill(`scrape-engine`/`feishu-db`/`cloakbrowser`)的独立章节。
- 不在这份设计里处理"收到评论后具体怎么改 skill"的流程——那是每次看到反馈时的日常工作,不是本次要建的固定机制。

## 验收

- 飞书文档存在,9 个 skill 各有一节,读起来是业务人员能看懂的叙事文,不出现技术名词。
- `docs/business-doc-sync-manifest.json` 存在,9 个 skill 各有一条记录(skill 名 → 当前同步的 commit SHA)。
- `scripts/check-business-doc-sync.sh` 存在且可执行,对着当前仓库跑一遍应该报告"全部已同步"(因为 manifest 是跟着这次创建文档同时写入的)。
- 手动改一个 skill 的 `SKILL.md` 后再跑脚本,应该报告该 skill 已过期。
