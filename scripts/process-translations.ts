#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

// 中文翻译映射
const chineseTranslations: Record<string, string> = {
  'Access': '访问',
  'Access Level': '访问级别',
  'Active': '活跃',
  'Add Automation': '添加自动化',
  'Add New Label': '添加新标签',
  'Add Skill': '添加技能',
  'Add Source': '添加数据源',
  'Add Workspace': '添加工作区',
  'Additional context for the AI assistant': 'AI助手的额外上下文',
  'After': '之后',
  'Agentic': '智能体',
  'All Chats': '所有对话',
  'All credentials and API keys': '所有凭证和API密钥',
  'All preferences and session data': '所有偏好设置和会话数据',
  'All Sessions': '所有会话',
  'All workspaces and their settings': '所有工作区及其设置',
  'Allow Commands': '允许命令',
  'Allow Network': '允许网络',
  'Allow System': '允许系统',
  'Allow Write': '允许写入',
  'Allowed': '已允许',
  'Anthropic': 'Anthropic',
  'API Key': 'API密钥',
  'APIs': 'APIs',
  'Appearance': '外观',
  'Archive': '归档',
  'Archived': '已归档',
  'Ask to Edit': '询问编辑',
  'Auth Required': '需要认证',
  'Authenticate with this source to view available data': '使用此数据源进行认证以查看可用数据',
  'Automation': '自动化',
  'Automations': '自动化',
  'Back': '返回',
  'Back up any important data first!': '请先备份所有重要数据！',
  'Backlog': '待办',
  'Before': '之前',
  'Billing': '账单',
  'Blocked': '已阻止',
  'Browse': '浏览',
  'Button': '按钮',
  'Cancel': '取消',
  'Cancelled': '已取消',
  'Cannot connect to remote server': '无法连接到远程服务器',
  'Change': '更改',
  'Change the API endpoint': '更改API端点',
  'Chat': '对话',
  'Chat History': '对话历史',
  'Check for Updates': '检查更新',
  'Choose an existing folder as workspace.': '选择一个现有文件夹作为工作区。',
  'Choose how you pay': '选择付款方式',
  'Clear Chat': '清空对话',
  'Clear Selection': '清除选择',
  'Close': '关闭',
  'Code': '代码',
  'Collapse': '折叠',
  'Color': '颜色',
  'Conditions that must pass before actions run': '操作运行前必须满足的条件',
  'Configure Labels': '配置标签',
  'Configure Statuses': '配置状态',
  'Confirm': '确认',
  'Connect to remote server': '连接到远程服务器',
  'Connected': '已连接',
  'Connecting to remote server': '正在连接远程服务器',
  'Connection Failed': '连接失败',
  'Connection has not been tested': '连接尚未测试',
  'Connection to remote server lost': '与远程服务器的连接已断开',
  'Connections': '连接',
  'Content': '内容',
  'Continue': '继续',
  'Conversations': '对话',
  'Copy': '复制',
  'Copy Link': '复制链接',
  'Copy Path': '复制路径',
  'Craft': 'Craft',
  'Craft Agent needs Git Bash to run shell commands on Windows. It was not found on your system.': 'Craft Agent需要Git Bash才能在Windows上运行shell命令。您的系统上未找到。',
  'Craft Agents Backend': 'Craft Agents后端',
  'Create': '创建',
  'Create a new chat session': '创建新对话',
  'Create a new chat session in a new panel': '在新面板中创建新对话',
  'Create Label': '创建标签',
  'Create new': '创建新的',
  'Create Workspace': '创建工作区',
  'Cycle Permission Mode': '切换权限模式',
  'Dark': '深色',
  'Date': '日期',
  'Debug': '调试',
  'Delete': '删除',
  'Delete Chat': '删除对话',
  'Delete Label': '删除标签',
  'Delete Skill': '删除技能',
  'Delete Source': '删除数据源',
  'Delete View': '删除视图',
  'Description': '描述',
  'Design': '设计',
  'Desktop notifications': '桌面通知',
  'Development': '开发',
  'Disable': '禁用',
  'Disabled': '已禁用',
  'Disconnected': '已断开',
  'Done': '已完成',
  'Duplicate': '复制',
  'Edit': '编辑',
  'Edit Configuration': '编辑配置',
  'Edit File': '编辑文件',
  'Edit Label': '编辑标签',
  'Edit Labels': '编辑标签',
  'Edit Shortcuts': '编辑快捷键',
  'Edit Views': '编辑视图',
  'Enable': '启用',
  'Enable Spell Check': '启用拼写检查',
  'Enabled': '已启用',
  'English': '英语',
  'Enter answer': '输入答案',
  'Event': '事件',
  'Execute': '执行',
  'Expand': '展开',
  'Explore': '探索',
  'Explore Mode': '探索模式',
  'Explore mode rules': '探索模式规则',
  'Export Chat': '导出对话',
  'Failed to connect to source': '连接数据源失败',
  'Figma Community: trending design systems': 'Figma社区：热门设计系统',
  'Filter Chats': '筛选会话',
  'Flag': '标记',
  'Flagged': '已标记',
  'Focus Chat': '聚焦对话',
  'Focus Navigator': '聚焦导航器',
  'Focus Next Panel': '聚焦下一个面板',
  'Focus Next Zone': '聚焦下一个区域',
  'Focus Previous Panel': '聚焦上一个面板',
  'Focus Sidebar': '聚焦侧边栏',
  'Font': '字体',
  'Font Size': '字体大小',
  'Frequency Penalty': '频率惩罚',
  'General': '通用',
  'Get notified when AI finishes working': 'AI完成工作时收到通知',
  'Get Started': '开始使用',
  'Git Bash Required': '需要Git Bash',
  'GitHub Copilot': 'GitHub Copilot',
  'GitHub Docs: latest Actions updates': 'GitHub文档：最新Actions更新',
  'Go Back': '返回',
  'Go Forward': '前进',
  'Google Search docs: Core Web Vitals checklist': 'Google搜索文档：Core Web Vitals清单',
  'Group': '分组',
  'HeaderIconButton': '头部图标按钮',
  'Help': '帮助',
  'Help & Documentation': '帮助和文档',
  'Icon': '图标',
  'Info': '信息',
  'Input': '输入',
  'Install Update': '安装更新',
  'Interface language': '界面语言',
  'Keyboard shortcuts': '键盘快捷键',
  'Keyboard Shortcuts': '键盘快捷键',
  'Kimi': 'Kimi',
  'Label': '标签',
  'Labels': '标签',
  'Language': '语言',
  'Last week': '上周',
  'Last month': '上个月',
  'Launch Browser': '启动浏览器',
  'Learn More': '了解更多',
  'Light': '浅色',
  'Local Folders': '本地文件夹',
  'Local MCP servers are disabled': '本地MCP服务器已禁用',
  'Log Out': '退出登录',
  'Login': '登录',
  'Logout': '退出',
  'MCPs': 'MCPs',
  'Main': '主要',
  'Manage Labels': '管理标签',
  'Managed by project': '由项目管理',
  'Max Tokens': '最大令牌数',
  'Mcp server failed to connect': 'MCP服务器连接失败',
  'Mcp server needs authentication': 'MCP服务器需要认证',
  'Message': '消息',
  'Minimax': 'Minimax',
  'Model': '模型',
  'More': '更多',
  'Name': '名称',
  'Nav': '导航',
  'Navigate to next panel': '导航到下一个面板',
  'Navigate to next session': '导航到下一个会话',
  'Navigate to previous panel': '导航到上一个面板',
  'Navigate to previous session': '导航到上一个会话',
  'Navigation': '导航',
  'Need to authenticate': '需要认证',
  'Needs Review': '需要审核',
  'Network': '网络',
  'New Chat': '新对话',
  'New Chat in Panel': '在面板中创建新对话',
  'New Session': '新会话',
  'New Window': '新窗口',
  'Next': '下一步',
  'No': '否',
  'No status found': '未找到状态',
  'No sessions yet': '暂无会话',
  'Not Tested': '未测试',
  'Notes': '笔记',
  'Notification': '通知',
  'Notifications': '通知',
  'Observations': '观察',
  'OK': '确定',
  'Ollama': 'Ollama',
  'Open': '打开',
  'Open folder': '打开文件夹',
  'Open in Browser': '在浏览器中打开',
  'Open in New Panel': '在新面板中打开',
  'Open in New Window': '在新窗口中打开',
  'OpenRouter': 'OpenRouter',
  'OpenAI': 'OpenAI',
  'Options': '选项',
  'Output': '输出',
  'Panel': '面板',
  'Password': '密码',
  'Paste': '粘贴',
  'Permission': '权限',
  'Permissions': '权限',
  'Port': '端口',
  'Presence Penalty': '存在惩罚',
  'Preferences': '偏好设置',
  'Presets': '预设',
  'Priority': '优先级',
  'Project': '项目',
  'Quit': '退出',
  'Recent Activity': '最近活动',
  'Recent Chats': '最近对话',
  'Reconnecting to remote server': '正在重新连接远程服务器',
  'Redo': '重做',
  'Regenerate Title': '重新生成标题',
  'Remote Server': '远程服务器',
  'Remote server access': '远程服务器访问',
  'Remote server connection status': '远程服务器连接状态',
  'Rename': '重命名',
  'Rename Chat': '重命名对话',
  'Repeats': '重复',
  'Research': '研究',
  'Reset': '重置',
  'Reset App': '重置应用',
  'Reset Shortcuts': '重置快捷键',
  'Reset Zoom': '重置缩放',
  'Run Test': '运行测试',
  'Save': '保存',
  'Save Changes': '保存更改',
  'Save Chat': '保存对话',
  'Schedule expression': '调度表达式',
  'Scheduled': '定时任务',
  'Search': '搜索',
  'Search Results': '搜索结果',
  'Searched titles and message content': '已搜索的标题和消息内容',
  'Select All': '全选',
  'Select Workspace': '选择工作区',
  'Send Key': '发送键',
  'Send message': '发送消息',
  'Server': '服务器',
  'Session Expired': '会话已过期',
  'Sessions': '会话',
  'Settings': '设置',
  'Setup later': '稍后设置',
  'Share': '分享',
  'Share Chat': '分享对话',
  'Shared': '已分享',
  'Shortcuts': '快捷键',
  'Show in Explorer': '在文件管理器中显示',
  'Show keyboard shortcuts reference': '显示键盘快捷键参考',
  'Skills': '技能',
  'Skills are reusable instructions that teach your agent specialized behaviors.': '技能是可重用的指令，教您的智能体专业行为。',
  'Source is connected and working': '数据源已连接并正常工作',
  'Source requires authentication': '数据源需要认证',
  'Source requires authentication to connect': '数据源需要认证才能连接',
  'Sources': '数据源',
  'Sources connect your agent to external data — MCP servers, REST APIs, and local folders.': '数据源将您的智能体连接到外部数据 — MCP服务器、REST API和本地文件夹。',
  'Spell Check': '拼写检查',
  'Start fresh with an empty workspace.': '从空工作区重新开始。',
  'Status': '状态',
  'Statuses': '状态',
  'Stop Processing': '停止处理',
  'Stop Sharing': '停止分享',
  'Subtitle': '副标题',
  'Switch between light and dark mode': '在浅色和深色模式之间切换',
  'System': '系统',
  'System default': '系统默认',
  'Temperature': '温度',
  'Test Failed': '测试失败',
  'Theme': '主题',
  'Then': '然后',
  'Thinking Level': '思考级别',
  'Timezone': '时区',
  'Timing': '时间',
  'Title': '标题',
  'Today': '今天',
  'Todo': '待处理',
  'Toggle DevTools': '切换开发工具',
  'Toggle Focus Mode': '切换专注模式',
  'Toggle Sidebar': '切换侧边栏',
  'Toggle Theme': '切换主题',
  'Tool': '工具',
  'Tool Icons': '工具图标',
  'Top P': 'Top P',
  'Type': '类型',
  'Unarchive': '取消归档',
  'Undo': '撤销',
  'Unflag': '取消标记',
  'Unknown error': '未知错误',
  'Update Settings': '更新设置',
  'Update Share': '更新分享',
  'Use a remote Craft Agent Server.': '使用远程Craft Agent服务器。',
  'User preferences': '用户偏好',
  'Username': '用户名',
  'Vercel': 'Vercel',
  'View': '视图',
  'View Fullscreen': '全屏查看',
  'Welcome to Craft Agents': '欢迎使用Craft Agents',
  'What causes this automation to run': '什么触发此自动化运行',
  'What would you like to work on?': '您想做什么？',
  'When': '何时',
  'Where your ideas meet the tools to make them happen.': '让您的想法遇到实现它们的工具。',
  'Window': '窗口',
  'Working Directory': '工作目录',
  'Workspace': '工作区',
  'Writing': '写作',
  'Yesterday': '昨天',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Yes': '是',
  'Add': '添加',
  'Cut': '剪切',
  'Paste': '粘贴',
  'Select All': '全选',
  'Undo': '撤销',
  'Redo': '重做',
  'Managed by project': '由项目管理',
};

function main() {
  // 读取翻译键文件
  const keysPath = path.join(__dirname, '..', 'translation-keys.json');
  const keysData = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));

  // 读取现有的翻译文件
  const enUsPath = path.join(__dirname, '..', 'apps', 'electron', 'src', 'renderer', 'i18n', 'locales', 'en-US.ts');
  const zhCnPath = path.join(__dirname, '..', 'apps', 'electron', 'src', 'renderer', 'i18n', 'locales', 'zh-CN.ts');

  // 读取现有的翻译内容
  let enUsContent = fs.readFileSync(enUsPath, 'utf-8');
  let zhCnContent = fs.readFileSync(zhCnPath, 'utf-8');

  // 收集需要添加的翻译
  const newTranslations: Array<{ key: string; en: string; zh: string }> = [];

  keysData.forEach((item: any) => {
    const zh = chineseTranslations[item.en] || '';
    if (zh) {
      newTranslations.push({
        key: item.key,
        en: item.en,
        zh: zh
      });
    }
  });

  console.log(`Found ${newTranslations.length} translations to add`);

  // 添加到common部分
  const commonSection = '  // Common\n  common: {';
  const enUsInsertPoint = enUsContent.indexOf(commonSection);
  const zhCnInsertPoint = zhCnContent.indexOf(commonSection);

  if (enUsInsertPoint !== -1 && zhCnInsertPoint !== -1) {
    // 在common部分添加新的翻译
    const enUsInsertBefore = enUsContent.indexOf('\n  }', enUsInsertPoint);
    const zhCnInsertBefore = zhCnContent.indexOf('\n  }', zhCnInsertPoint);

    let enUsAdditions = '';
    let zhCnAdditions = '';

    newTranslations.forEach(translation => {
      // 检查是否已经存在
      if (!enUsContent.includes(`    ${translation.key}:`)) {
        enUsAdditions += `    ${translation.key}: '${translation.en.replace(/'/g, "\\'")}',\n`;
        zhCnAdditions += `    ${translation.key}: '${translation.zh.replace(/'/g, "\\'")}',\n`;
      }
    });

    if (enUsAdditions) {
      enUsContent = enUsContent.slice(0, enUsInsertBefore) + '\n' + enUsAdditions + enUsContent.slice(enUsInsertBefore);
      zhCnContent = zhCnContent.slice(0, zhCnInsertBefore) + '\n' + zhCnAdditions + zhCnContent.slice(zhCnInsertBefore);

      // 写回文件
      fs.writeFileSync(enUsPath, enUsContent, 'utf-8');
      fs.writeFileSync(zhCnPath, zhCnContent, 'utf-8');
      console.log('Translations added successfully!');
    } else {
      console.log('All translations already exist');
    }
  }

  // 输出需要手动替换的文件列表
  console.log('\nFiles that need manual replacement:');
  const uniqueFiles = new Set<string>();
  keysData.forEach((item: any) => {
    item.files.forEach((file: string) => {
      uniqueFiles.add(file);
    });
  });
  
  Array.from(uniqueFiles).sort().forEach(file => {
    console.log(`  - ${file}`);
  });
}

main();
