# 配方:初始化/部署(一次性)

larkdepot binary 零业务常量,新装 = 空库。业务配置在本目录 `config/` 下,初始化时导入:

    # ① 导入采购域的表清单(幂等,重名自动跳过)
    larkdepot register --from config/seed.toml

    # ② 注册写回模板(重名会被拒绝;模板变更=起新名字)
    larkdepot template add config/templates/batch-result.toml

    # ③ 首次全量同步 + 验证
    larkdepot sync
    larkdepot status      # 核对 8 表行数、freshness
    larkdepot schema      # 核对 registry/templates 已就位

- 加业务表 = `config/seed.toml` 加一段 `[[pull]]` 再跑一次 ①,或单表 `larkdepot register "<飞书表URL>" --name 表名`。
- 加业务模板 = `config/templates/` 加一个 TOML 再跑 ②;字段必须含 `row_key`(text)。
- prod 的 cron 只跑 `larkdepot sync`,初始化只在部署时做一次。
