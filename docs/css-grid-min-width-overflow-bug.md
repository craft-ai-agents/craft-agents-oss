# CSS Grid min-width 溢出导致侧边栏 Badge 消失

## 问题描述

在 commit `4df0440`（feat: add working directory filter and sidebar grouping）之后，当侧边栏中 "All Chats" 区域展开（显示工作目录子项）时，所有侧边栏项目的计数 badge（如 Labels 旁的聊天数量）在 hover 时不再显示。

**复现步骤：**
1. 展开 Labels 区域 → hover 时可以看到各标签的关联 Chat 个数 ✓
2. 展开 All Chats 区域（显示工作目录子项）
3. 再次 hover Labels 区域 → 数字消失 ✗

**影响范围：** 所有侧边栏 badge（Flagged、Status、Labels、Sources 等的计数），不仅限于 Labels。

## 根因分析

### 引入点

commit `4df0440` 在 `LeftSidebar.tsx` 中将标题从纯文本节点改为了 `<span className="truncate">` 包裹：

```diff
- {link.title}
+ <span className="truncate">{link.title}</span>
```

### CSS 传播链

Tailwind 的 `truncate` 类生成以下 CSS：

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

其中 `white-space: nowrap` 是问题的根本原因。以下是溢出传播的完整链路：

```
1. 标题 <span> 有 white-space: nowrap
   → min-content 宽度 = 完整文字宽度（不能换行）

2. 按钮 <button> 是 flex 容器
   → 按钮的 min-content = 所有 flex 子项的 min-width 之和
   → 对于 flex item，overflow: hidden 会将 min-width: auto 降为 0
   → 但 white-space: nowrap 使得文字的固有最小宽度很大

3. group/section <div> 是 CSS Grid item
   → Grid item 的自动最小尺寸(automatic minimum size) = 子内容的 min-content
   → 没有 overflow: hidden 也没有 min-width: 0 → 使用完整的 min-content

4. 顶层 <nav> 是 CSS Grid 容器 (display: grid)
   → Grid 列宽度 = max(所有 grid item 的 min-content, 可用空间)
   → 当某个 grid item 的 min-content > 可用空间时，Grid 列宽度 > 容器宽度

5. 滚动容器有 overflow-y: auto
   → CSS 规范：当 overflow-y ≠ visible 时，overflow-x 也变为 auto
   → 水平方向超出容器的内容被裁剪

6. Badge 在按钮的最右侧（ml-auto 推到右边缘）
   → 被水平溢出裁剪 → 不可见
```

### 为什么只在展开 All Chats 时才出现？

当 All Chats 折叠时，侧边栏只有顶层按钮（标题较短，min-content 不会超出容器宽度）。当 All Chats 展开时，nested 子项（工作目录）的按钮标题也有 `white-space: nowrap`，其 min-content 通过以下 DOM 层级传播：

```
nested 按钮标题 (truncate/nowrap)
  → nested 按钮 (flex 容器)
    → nested group/section div (block element)
      → motion.div (stagger 动画包裹器, nested grid item)
        → nested nav (grid 容器)
          → wrapper div (block)
            → motion.div (展开内容, overflow: hidden — 但 block 元素的 overflow:hidden 不影响 intrinsic sizing)
              → All Chats group/section div (顶层 grid item ← 问题在这里)
                → 顶层 nav (grid 容器 → 列宽被撑大)
```

**关键点：** `overflow: hidden` 对 block 元素不会改变其 intrinsic size 对父元素的贡献。只有在 **flex item** 或 **grid item** 上时，`overflow: hidden` 才会将自动最小尺寸降为 0。

## 修复方案

在 `LeftSidebar.tsx` 中，给所有 CSS Grid item 添加 `min-w-0`（`min-width: 0`）：

```diff
// 1. 主 sidebar 项目的 wrapper div (grid item)
- <div className="group/section">
+ <div className="group/section min-w-0">

// 2. nested 项目的 stagger 动画包裹器 (nested grid item)
- <motion.div key={link.id} variants={itemVariants}>
+ <motion.div key={link.id} variants={itemVariants} className="min-w-0">

// 3. sortable status list 的 wrapper div (grid item)
- <div className="group/section">
+ <div className="group/section min-w-0">
```

### 为什么 `min-w-0` 能修复？

CSS Grid 规范规定：
> Grid item 的自动最小尺寸(automatic minimum size) 默认为其内容的 min-content 宽度。但如果显式设置了 `min-width`（如 `min-width: 0`），则使用显式值代替自动值。

`min-w-0` 告诉 Grid："这个 item 可以缩小到 0 宽度"。Grid 列不会因为某个 item 的内容宽度而被撑大，从而保持在容器范围内。

## 经验教训

1. **`white-space: nowrap` 会影响 CSS Grid 布局**：在 Grid item 内使用 `nowrap` 时，min-content 宽度可能传播到 Grid 列，导致溢出。

2. **`overflow: hidden` 在不同上下文中行为不同**：
   - 在 **flex item** 上：将自动最小尺寸降为 0 ✓
   - 在 **grid item** 上：将自动最小尺寸降为 0 ✓
   - 在普通 **block element** 上：不影响 intrinsic sizing ✗

3. **`min-w-0` 是 Grid/Flex 布局中的安全阀**：当不确定子内容宽度时，给 Grid/Flex item 加 `min-w-0` 可以防止意外溢出。这是一个常见的 CSS 最佳实践。

4. **调试方法**：当怀疑 overflow 裁剪时，可以将目标元素放到按钮的最前面（左侧）测试 — 如果左侧可见右侧不可见，确认是水平溢出裁剪。

## 相关 Commit

- 引入问题：`4df0440` (feat: add working directory filter and sidebar grouping)
- 修复：`81b74e5` (style: prevent sidebar item overflow with min-w-0)
