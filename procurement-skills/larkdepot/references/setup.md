# 配方:初始化/部署(一次性)

## ⓪ 装/升级 binary(私有 repo,GitHub Release 分发 musl 静态 binary)

    # 拉指定版本的静态 binary(x86_64 musl,static-pie,无动态依赖,prod 内核 5.15 可跑)
    gh release download v0.1.0 --repo cunninghamcard-bit/larkdepot \
      --pattern 'larkdepot-x86_64-linux-musl' --dir /tmp --clobber
    install -m 0755 /tmp/larkdepot-x86_64-linux-musl "$(dirname "$(command -v larkdepot || echo /usr/local/bin/x)")/larkdepot" 2>/dev/null \
      || install -m 0755 /tmp/larkdepot-x86_64-linux-musl /usr/local/bin/larkdepot
    larkdepot --version   # 核对版本

- 升级 = 换 `download` 的版本号重跑本步,原子覆盖 PATH 里的 binary(binary 无状态,DB 不受影响)。
- 需要 `gh auth` 能读私有 repo;没有 gh 时用 release 页面的资产直链 `curl -L -o` 也可。
- 首次部署:装完 binary 后往下走 ①②③;老机器从 `feishu-db` 迁来的,记得把 cron 里的 `feishu-db sync` 改成 `larkdepot sync`。

## 导入业务配置

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
