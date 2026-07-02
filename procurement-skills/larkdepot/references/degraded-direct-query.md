# 配方:缓存不可用时的降级直查

**前提**:先按 SKILL.md 的判定标准确认缓存真的不可用(命令本身失败 / `freshness.synced_at` 为 null)。查得到但结果为空不算,那是权威答案。

降级 = 用 lark-cli 直查飞书源表。**串行、一张一张查,绝不并发**;遇限流 `800004135` 等几秒重试,静默处理:

    # 目标表的 app_token/table_id 从 schema 输出的 registry 里拿,不要手抄硬编码
    larkdepot schema
    lark-cli base +record-search --as user --base-token <app_token> --table-id <table_id> --json '{"keyword":"<关键词>","search_fields":["<字段>","..."]}'

- 子命令必须带 `+` 前缀。`search_fields` 按业务 skill 声明的检索口径填(库存查询按「型号」;供应商检索按「主营品牌」「优势产品」「询价品牌」)。
- 若返回 `91403 permission`/登录失效,如实告诉用户需要开 base 读权限 / 重登 lark-cli,不要编造数据,不要反复切身份重试。
- 极端情况(binary 整个缺失连 `schema` 都跑不了):让用户提供表链接,不要凭记忆猜 token。
