// Chinese language pack
export const zhCN = {
  // Settings
  settings: {
    app: {
      label: '应用',
      description: '通知和更新'
    },
    ai: {
      label: 'AI',
      description: '模型、思考、连接'
    },
    appearance: {
      label: '外观',
      description: '主题、字体、工具图标'
    },
    input: {
      label: '输入',
      description: '发送键、拼写检查'
    },
    workspace: {
      label: '工作区',
      description: '名称、图标、工作目录'
    },
    permissions: {
      label: '权限',
      description: '探索模式规则'
    },
    labels: {
      label: '标签',
      description: '管理会话标签'
    },
    server: {
      label: '服务器',
      description: '远程服务器访问'
    },
    shortcuts: {
      label: '快捷键',
      description: '键盘快捷键'
    },
    preferences: {
      label: '偏好设置',
      description: '用户偏好设置'
    },
    language: {
      label: '语言',
      description: '界面语言',
      enUS: '英语',
      zhCN: '中文'
    }
  },
  
  // Common
  common: {
    openInNewWindow: '在新窗口中打开',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    close: '关闭',
    back: '返回',
    next: '下一步',
    confirm: '确认',
    ok: '确定',
    yes: '是',
    no: '否',
    newWindow: '新窗口',
    settings: '设置',
    help: '帮助',
    helpDocumentation: '帮助和文档',
    automations: '自动化',
    debug: '调试',
    checkForUpdates: '检查更新',
    installUpdate: '安装更新',
    toggleDevTools: '切换开发者工具',
    quit: '退出 Craft Agents'
  },
  
  // Menu
  menu: {
    edit: '编辑',
    view: '查看',
    window: '窗口',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetZoom: '重置缩放',
    toggleFocusMode: '切换专注模式',
    toggleSidebar: '切换侧边栏',
    minimize: '最小化',
    maximize: '最大化'
  },
  
  // Chat
  chat: {
    sendMessage: '发送消息',
    thinking: '思考中...',
    typing: '输入中...',
    newChat: '新聊天',
    saveChat: '保存聊天',
    deleteChat: '删除聊天',
    renameChat: '重命名聊天',
    shareChat: '分享聊天',
    exportChat: '导出聊天',
    clearChat: '清空聊天',
    chatHistory: '聊天历史',
    recentChats: '最近聊天',
    allChats: '所有聊天'
  },
  
  // AI
  ai: {
    model: '模型',
    thinkingLevel: '思考级别',
    connections: '连接',
    apiKey: 'API 密钥',
    temperature: '温度',
    maxTokens: '最大令牌',
    topP: 'Top P',
    frequencyPenalty: '频率惩罚',
    presencePenalty: '存在惩罚'
  },
  
  // Appearance
  appearance: {
    theme: '主题',
    light: '浅色',
    dark: '深色',
    system: '系统',
    font: '字体',
    fontSize: '字体大小',
    toolIcons: '工具图标'
  },
  
  // Workspace
  workspace: {
    name: '名称',
    icon: '图标',
    workingDirectory: '工作目录',
    browse: '浏览',
    reset: '重置'
  },
  
  // Permissions
  permissions: {
    exploreMode: '探索模式',
    allowCommands: '允许命令',
    allowWrite: '允许写入',
    allowNetwork: '允许网络',
    allowSystem: '允许系统'
  },
  
  // Labels
  labels: {
    manageLabels: '管理标签',
    createLabel: '创建标签',
    editLabel: '编辑标签',
    deleteLabel: '删除标签',
    color: '颜色',
    name: '名称'
  },
  
  // Server
  server: {
    remoteServer: '远程服务器',
    enabled: '已启用',
    url: 'URL',
    port: '端口',
    username: '用户名',
    password: '密码'
  },
  
  // Shortcuts
  shortcuts: {
    keyboardShortcuts: '键盘快捷键',
    editShortcuts: '编辑快捷键',
    resetShortcuts: '重置快捷键',
    saveChanges: '保存更改'
  },
  
  // Input
  input: {
    sendKey: '发送键',
    spellCheck: '拼写检查',
    enableSpellCheck: '启用拼写检查',
    whatWouldYouLike: '你想做什么工作？',
    shiftTabSwitch: '使用 Shift + Tab 在探索和执行之间切换',
    typeAtMention: '输入 @ 来提及文件、文件夹或技能',
    typeHashLabels: '输入 # 为对话添加标签',
    shiftReturnNewLine: '按 Shift + Enter 添加新行',
    cmdBToggleSidebar: '按 {cmdKey} + B 切换侧边栏',
    cmdDotFocusMode: '按 {cmdKey} + . 进入专注模式'
  },
  
  // Session list
  sessionList: {
    today: '今天',
    yesterday: '昨天',
    allSessions: '所有会话',
    flagged: '已标记',
    archived: '已归档',
    searchResults: '搜索结果',
    noSessions: '未找到会话',
    searchedContent: '已搜索标题和消息内容'
  },
  
  // Reset dialog
  resetDialog: {
    title: '重置应用',
    warning: '这将 <strong>永久删除</strong>:',
    deleteItem1: '所有工作区及其设置',
    deleteItem2: '所有凭证和API密钥',
    deleteItem3: '所有偏好设置和会话数据',
    backupWarning: '请先备份重要数据！',
    undoWarning: '此操作无法撤销。',
    confirmPrompt: '请解决以下问题以确认：{a} + {b} =',
    answerPlaceholder: '输入答案'
  },
  
  // Workspace picker
  workspacePicker: {
    title: '选择工作区',
    description: '选择此服务器上的工作区，或创建一个新的工作区。',
    loading: '正在加载工作区...',
    placeholder: '新工作区名称',
    creating: '创建中...',
    createButton: '创建工作区'
  },
  
  // Sidebar
  sidebar: {
    allSessions: '所有会话',
    flagged: '已标记',
    archived: '已归档',
    labels: '标签',
    sources: '数据源',
    apis: 'APIs',
    mcps: 'MCPs',
    localFolders: '本地文件夹',
    skills: '技能',
    automations: '自动化',
    scheduled: '定时任务',
    eventBased: '事件触发',
    agentic: '智能体',
    settings: '设置',
    whatsNew: '新功能'
  },

  // Session Statuses
  statuses: {
    backlog: '待办',
    todo: '待处理',
    needsReview: '需要审核',
    done: '已完成',
    cancelled: '已取消'
  },

  // Labels
  labels: {
    content: '内容',
    design: '设计',
    research: '研究',
    writing: '写作',
    development: '开发',
    automation: '自动化',
    bug: 'Bug',
    code: '代码',
    priority: '优先级',
    project: '项目'
  },

  // UI Elements
  ui: {
    allSessions: '所有会话',
    filterChats: '筛选会话',
    searchStatusesAndLabels: '搜索状态和标签...',
    statuses: '状态',
    group: '分组',
    search: '搜索',
    share: '分享',
    flag: '标记',
    archive: '归档',
    rename: '重命名',
    regenerateTitle: '重新生成标题',
    openInNewPanel: '在新面板中打开',
    openInNewWindow: '在新窗口中打开',
    showInExplorer: '在文件管理器中显示',
    copyPath: '复制路径',
    delete: '删除',
    filterStatuses: '筛选状态...',
    unflag: '取消标记',
    unarchive: '取消归档',
    markAsUnread: '标记为未读',
    sendToWorkspace: '发送到工作区...',
    openInBrowser: '在浏览器中打开',
    copyLink: '复制链接',
    updateShare: '更新分享',
    stopSharing: '停止分享',
    shared: '已分享',
    noStatusFound: '未找到状态'
  },

  // Onboarding
  onboarding: {
    welcome: {
      title: '欢迎使用 Craft Agents',
      description: '为代理提供应有的用户体验。连接任何东西。组织您的会话。满足您工作所需的一切！',
      existingTitle: '更新设置',
      existingDescription: '更新您的API连接或更改设置。',
      checking: '检查中...',
      getStarted: '开始使用'
    }
  }
};
