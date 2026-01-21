/**
 * Chinese (Simplified) translations for Craft Agents
 *
 * 简体中文翻译
 */

export default {
  // Navigation / 导航
  allChats: '所有对话',
  settings: '设置',
  flagged: '已标记',
  sources: '来源',
  skills: '技能',
  workspace: '工作空间',

  // Actions / 操作
  newChat: '新建对话',
  delete: '删除',
  cancel: '取消',
  save: '保存',
  confirm: '确认',
  continue: '继续',
  back: '返回',
  skip: '跳过',
  allow: '允许',
  deny: '拒绝',
  copy: '复制',
  open: '打开',
  close: '关闭',
  rename: '重命名',
  share: '分享',
  refresh: '刷新',
  edit: '编辑',
  done: '完成',

  // Session Management / 会话管理
  deleteConversation: '删除对话',
  deleteConversationTitle: '删除对话',
  deleteConversationMessage: '确定要删除"{{name}}"吗？此操作无法撤销。',
  conversationDeleted: '对话已删除',
  renameConversation: '重命名对话',
  untitled: '无标题',
  noConversationsYet: '还没有对话',
  noSessionSelected: '未选择会话',
  loadingSession: '正在加载会话...',

  // Empty States / 空状态
  noSourcesConfigured: '未配置来源',
  noSkillsConfigured: '未配置技能',
  noConversationsFound: '未找到对话',

  // Form Placeholders / 表单占位符
  message: '消息...',
  filterStatuses: '筛选状态...',
  enterYourName: '输入您的名称...',
  selectTimezone: '选择时区...',
  searchConversations: '搜索对话...',

  // Status Labels / 状态标签
  todo: '待办',
  inProgress: '进行中',
  needsReview: '待审核',
  processing: '处理中...',
  complete: '完成',
  errorStatus: '错误',

  // Toast Messages / 提示消息
  linkCopiedToClipboard: '链接已复制到剪贴板',
  failedToShare: '分享失败',
  titleRefreshed: '标题已刷新',
  workspaceCreated: '工作空间已创建',
  settingsSaved: '设置已保存',
  failedToCopyPattern: '复制模式失败',
  patternCopiedToClipboard: '模式已复制到剪贴板',
  shareUpdated: '分享已更新',
  failedToUpdateShare: '更新分享失败',
  sharingStopped: '已停止分享',
  failedToStopSharing: '停止分享失败',
  terminalOverlayNotAvailable: '终端覆盖层不可用',
  failedToLoadTaskOutput: '加载任务输出失败',
  noDetailsProvided: '未提供详细信息',
  deletedSource: '已删除来源',
  failedToDeleteSource: '删除来源失败',
  deletedSkill: '已删除技能：{{name}}',
  invalidLink: '无效链接',
  restored: '已恢复',
  openingURL: '正在打开 URL...',
  success: '成功！',
  errorToast: '出现问题，请重试。',
  info: '这里有一些有用的信息。',
  doneExclamation: '完成！',

  // Error Messages / 错误消息
  unknownError: '未知错误',
  networkRequestFailed: '网络请求失败',
  invalidCredentials: '无效的凭据',
  sessionExpired: '会话已过期',

  // Date/Time / 日期时间
  today: '今天',
  yesterday: '昨天',
  hoursAgo: '{{count}}小时前',
  daysAgo: '{{count}}天前',
  minutesAgo: '{{count}}分钟前',
  secondsAgo: '{{count}}秒前',

  // Accessibility Labels / 无障碍标签
  goBack: '返回',
  goForward: '前进',
  hideSidebar: '隐藏侧边栏',
  showSidebar: '显示侧边栏',
  changeTodoState: '更改待办状态',
  openSettings: '打开设置',

  // Dialog & Modal Text / 对话框和模态框文本
  confirmAction: '确认操作',
  chooseBillingMethod: '选择付费方式',

  // Onboarding / 引导流程
  welcomeToCraftAgents: '欢迎使用 Craft Agents',
  getStarted: '开始使用',

  // Settings / 设置
  language: '语言',
  languageChanged: '语言已更改。界面将随即更新。',
  selectLanguage: '选择语言',

  // Language Names / 语言名称
  english: 'English',
  chinese: '中文 (Chinese)',

  // Keyboard Shortcuts / 键盘快捷键
  pressKToSearch: '按 ⌘K 搜索',

  // Settings Navigator / 设置导航器
  settingsApp: '应用',
  settingsAppDescription: '外观、通知、账单',
  settingsWorkspace: '工作区',
  settingsWorkspaceDescription: '模型、模式循环、高级',
  settingsPermissions: '权限',
  settingsPermissionsDescription: '探索模式中允许的命令',
  settingsShortcuts: '快捷键',
  settingsShortcutsDescription: '键盘快捷键参考',
  settingsPreferences: '偏好设置',
  settingsPreferencesDescription: '您的个人偏好',
  openInNewWindow: '在新窗口中打开',

  // Preferences Page / 偏好设置页面
  preferencesTitle: '偏好设置',
  basicInfo: '基本信息',
  basicInfoDescription: '帮助 Craft Agent 为您个性化响应。',
  nameLabel: '姓名',
  nameDescription: 'Craft Agent 应该如何称呼您。',
  namePlaceholder: '您的姓名',
  timezoneLabel: '时区',
  timezoneDescription: '用于相对日期,如"明天"或"下周"。',
  timezonePlaceholder: '例如: America/New_York',
  languageLabel: '语言',
  languageDescription: 'Craft Agent 响应的首选语言。',
  languagePlaceholder: '例如: English',
  locationTitle: '位置',
  locationDescription: '启用位置感知响应,如天气、本地时间和区域上下文。',
  cityLabel: '城市',
  cityDescription: '您的城市,用于本地信息和上下文。',
  cityPlaceholder: '例如: New York',
  countryLabel: '国家',
  countryDescription: '您的国家,用于区域格式化和上下文。',
  countryPlaceholder: '例如: USA',
  notesTitle: '备注',
  notesDescription: '自由格式的上下文,帮助 Craft Agent 了解您的偏好。',
  notesPlaceholder: '您希望 Craft Agent 了解的任何其他上下文...',
  editFile: '编辑文件',

} as const;
