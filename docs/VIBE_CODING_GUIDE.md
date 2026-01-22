# Craft Agents: Vibe Coding 实战指南 (从0到1)

欢迎来到 **Craft Agents** 的世界！

这份指南专为**初学者 (小白)** 设计。你不需要是资深工程师，只需要掌握 **Vibe Coding**（凭感觉编程）的核心理念：**你负责描述“想要什么”(What)，让 AI 负责实现“怎么做”(How)。**

---

## 🚀 第一步：准备工作 (Prerequisites)

在开始之前，我们需要准备好基础的“魔法工具”。

### 1. 安装基础环境
打开你的终端 (Terminal)，逐行运行以下命令：

1.  **安装 Bun** (一个极速的 JavaScript 运行时，就像 AI 的跑车):
    ```bash
    curl -fsSL https://bun.sh/install | bash
    ```
    *安装完成后，请根据提示运行 `source ...` 命令或重启终端。*

2.  **验证安装**:
    ```bash
    bun --version
    ```
    *如果看到版本号（如 1.x.x），说明安装成功！*

### 2. 获取项目代码
如果你还没有下载代码，请运行：
```bash
git clone https://github.com/lukilabs/craft-agents-oss.git
cd craft-agents-oss
```

### 3. 安装依赖
```bash
bun install
```
*这一步会下载项目需要的所有零件，可能需要几分钟。*

---

## 🎮 第二步：启动控制台 (Quick Start)

现在，让我们启动 Craft Agents 的桌面应用：

```bash
bun run electron:dev
```

🎉 **成功了！** 你应该会看到一个漂亮的桌面应用界面。这就是你的 AI 指挥中心。

---

## 🧠 第三步：Vibe Coding 核心心法

Vibe Coding 的核心不是写代码，而是**与 AI 协作**。Craft Agents 提供了三个强大的工具来辅助你：

### 1. 模式切换 (Permission Modes)
你可以通过按 `SHIFT + TAB` 或点击界面上的锁图标来切换模式：

*   🛡️ **Safe Mode (Explore)**: **探索模式**（默认）。AI 只能看，不能改。
    *   *什么时候用？* 当你想问“这个项目是做什么的？”或者“帮我解释这段代码”时。
*   ✍️ **Ask Mode**: **询问模式**。AI 想改代码时会先弹窗问你。
    *   *什么时候用？* 当你让 AI 写代码，但想确认它到底改了什么时（新手推荐）。
*   ⚡ **Auto Mode (Allow All)**: **全自动模式**。AI 自动执行所有操作，不废话。
    *   *什么时候用？* 当你信任 AI，想让它快速完成“把所有 console.log 删掉”这种繁琐任务时。

### 2. 技能调用 (Skills)
Craft Agents 内置了 30+ 个专家级技能。你不需要自己从头教 AI，直接**召唤专家**！
在输入框输入 `/` 即可看到技能列表。

**小白必用的三个神技：**

1.  **/specs-writer (需求专家)**
    *   *用法*: `/specs-writer "我想做一个番茄钟功能，包含倒计时和休息提醒"`
    *   *效果*: AI 会帮你把模糊的想法变成清晰、专业的需求文档。**这是写代码前的第一步！**

2.  **/tech-stack-selector (架构师)**
    *   *用法*: `/tech-stack-selector "我要做个简单的个人博客，不想用数据库，怎么选型？"`
    *   *效果*: AI 会帮你分析并推荐最适合的技术栈（比如 Next.js + Markdown）。

3.  **/dev-implementation-guide (开发向导)**
    *   *用法*: `/dev-implementation-guide "我已经准备好写代码了，教我怎么开始"`
    *   *效果*: AI 会一步步指导你搭建环境、创建文件、运行测试。

### 3. 任务管理 (Tasks)
当任务比较复杂时，不要试图一句话说完。让 AI 帮你拆解任务。
*   *话术*: "我要实现登录功能。请先帮我列一个 Todo List，然后一步步做。"
*   AI 会自动使用 `TodoWrite` 工具来管理进度，你可以随时看到它做到了哪一步。

---

## ⚔️ 第四步：实战演练 (Hello World)

让我们通过一个简单的任务来体验 Vibe Coding：**“给应用加一个 About 页面”**。

### 1. 明确需求 (The Vibe)
在聊天框输入：
> 我想给这个应用加一个简单的 "About" 页面，显示版本号 v1.0.0 和一段介绍文字。请先用 /specs-writer 帮我写个简单的需求。

### 2. 生成需求
AI 会调用 `/specs-writer`，生成一份 `requirements.md`。你只需要阅读并回复：“看起来不错，继续。”

### 3. 开始编码
切换到 **Ask Mode** (或 Auto Mode)，然后输入：
> 好的，按照刚才的需求，帮我创建这个页面。请使用 shadcn/ui 的风格。

### 4. 观察与验收
AI 会自动：
1.  创建 `apps/electron/src/renderer/pages/About.tsx`。
2.  修改路由文件添加新页面。
3.  告诉你完成了。

你只需要看一眼运行中的应用，如果页面出现了，就回复：“太棒了！任务完成。”

---

## 📚 进阶技巧 (Pro Tips)

*   **遇到报错怎么办？**
    直接把报错信息复制给 AI，然后加一句：“修复它。”（Fix it）。不要自己硬啃报错日志。
*   **不知道代码在哪？**
    问 AI：“`/explore` 帮我找一下负责处理用户登录的文件是哪个？”
*   **觉得 AI 变笨了？**
    这时候通常是因为上下文太长了。输入 `/compact` 让 AI 整理一下记忆，或者直接开一个新的 Session（会话）。

---

## 总结

**Vibe Coding = 描述意图 (Intent) + 召唤技能 (Skills) + 审核结果 (Review)**

你不再是砌砖的工匠，你是**指挥官**。你的代码库就是你的军队，Craft Agents 就是你的参谋长。

**现在，去试着发布你的第一条指令吧！**
