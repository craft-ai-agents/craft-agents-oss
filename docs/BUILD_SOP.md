# Bunny 构建标准操作流程 (SOP)

## 概述

本文档描述如何构建 Bunny (Craft Agents) 的 macOS 发行版本。

## 环境要求

- **操作系统**: macOS
- **运行时**: [Bun](https://bun.sh/) (已安装并配置)
- **依赖**: 已执行 `bun install`

## 构建命令

### 1. 本地测试版本（无签名，快速构建）

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:dist:mac
```

**特点:**
- 构建时间: ~2-3 分钟
- 使用 ad-hoc 签名
- 适合本地开发和测试
- 无需等待 Apple 公证

**产出位置:**
```
apps/electron/release/
├── Bunny-arm64.dmg      # Apple Silicon (M1/M2/M3)
├── Bunny-x64.dmg        # Intel
├── Bunny-arm64.zip
└── Bunny-x64.zip
```

### 2. 正式发布版本（完整签名 + 公证）

```bash
bun run electron:dist:mac
```

**前置条件:**
- 配置 `CSC_LINK` 环境变量（开发者证书）
- 配置 `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`（公证凭据）

**特点:**
- 构建时间: 5-15 分钟（取决于 Apple 公证服务响应时间）
- 完整代码签名
- 通过 Apple 公证
- 可分发给外部用户

### 3. 快速构建（仅生成 .app，不打包 DMG）

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:dist:mac:dir
```

**特点:**
- 跳过 DMG/ZIP 打包步骤，直接生成 `.app` 目录
- 构建速度更快，适合内部测试
- 产物位置: `apps/electron/release/mac-arm64/Bunny.app` 或 `mac-x64/Bunny.app`

### 4. 仅构建特定架构

```bash
# 仅 Apple Silicon
CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:dist:mac -- --arm64

# 仅 Intel
CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:dist:mac -- --x64
```

## 构建流程详解

构建过程自动执行以下步骤：

1. **electron:build:main** - 编译主进程 (`dist/main.cjs`)
2. **electron:build:preload** - 编译 preload 脚本 (`dist/preload.cjs`)
3. **electron:build:renderer** - 使用 Vite 构建渲染进程
4. **electron:build:resources** - 复制资源文件
5. **electron:build:assets** - 复制文档资源
6. **electron-builder** - 打包、签名、生成 DMG

## 常见问题

### Q: 构建超时怎么办？

签名和公证过程可能很慢。使用本地测试版本命令跳过签名：
```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bun run electron:dist:mac
```

### Q: 如何只重新打包而不重新编译？

```bash
cd apps/electron
npx electron-builder --config electron-builder.yml --mac
```

### Q: 如何清理构建缓存？

```bash
bun run electron:clean
```

### Q: 构建产物在哪里？

```
apps/electron/release/
```

## 版本信息

当前版本定义在 `package.json` 中的 `version` 字段。

## 相关文件

- `apps/electron/electron-builder.yml` - Electron Builder 配置
- `package.json` - 构建脚本定义
- `scripts/` - 构建辅助脚本
