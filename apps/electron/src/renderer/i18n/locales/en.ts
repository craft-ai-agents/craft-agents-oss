/**
 * English translations for Craft Agents
 *
 * This file contains all English text strings for the application.
 * These serve as the source of truth for translations.
 */

export default {
  // Navigation
  allChats: 'All Chats',
  settings: 'Settings',
  flagged: 'Flagged',
  sources: 'Sources',
  skills: 'Skills',
  workspace: 'Workspace',
  craftMenu: 'Craft menu',
  keyboardShortcuts: 'Keyboard Shortcuts',
  storedUserPreferences: 'Stored User Preferences',
  resetApp: 'Reset App',
  sessions: 'Sessions',

  // Actions
  newChat: 'New Chat',
  delete: 'Delete',
  cancel: 'Cancel',
  save: 'Save',
  confirm: 'Confirm',
  continue: 'Continue',
  back: 'Back',
  skip: 'Skip',
  allow: 'Allow',
  deny: 'Deny',
  copy: 'Copy',
  open: 'Open',
  close: 'Close',
  rename: 'Rename',
  share: 'Share',
  refresh: 'Refresh',
  edit: 'Edit',
  done: 'Done',

  // Session Management
  deleteConversation: 'Delete conversation',
  deleteConversationTitle: 'Delete conversation',
  deleteConversationMessage: 'Are you sure you want to delete "{{name}}"? This action cannot be undone.',
  conversationDeleted: 'Conversation deleted',
  renameConversation: 'Rename conversation',
  renameChat: 'Rename Chat',
  untitled: 'Untitled',
  noConversationsYet: 'No conversations yet',
  noSessionSelected: 'No session selected',
  loadingSession: 'Loading session...',

  // Empty States
  noSourcesConfigured: 'No sources configured',
  noSkillsConfigured: 'No skills configured',
  noConversationsFound: 'No conversations found',

  // Form Placeholders
  message: 'Message...',
  filterStatuses: 'Filter statuses...',
  enterYourName: 'Enter your name...',
  selectTimezone: 'Select timezone...',
  searchConversations: 'Search conversations...',

  // Status Labels
  todo: 'Todo',
  inProgress: 'In Progress',
  needsReview: 'Needs Review',
  processing: 'Processing...',
  complete: 'Complete',
  errorStatus: 'Error',

  // Toast Messages
  linkCopiedToClipboard: 'Link copied to clipboard',
  failedToShare: 'Failed to share',
  titleRefreshed: 'Title refreshed',
  workspaceCreated: 'Workspace created',
  settingsSaved: 'Settings saved',
  failedToCopyPattern: 'Failed to copy pattern',
  patternCopiedToClipboard: 'Pattern copied to clipboard',
  shareUpdated: 'Share updated',
  failedToUpdateShare: 'Failed to update share',
  sharingStopped: 'Sharing stopped',
  failedToStopSharing: 'Failed to stop sharing',
  terminalOverlayNotAvailable: 'Terminal overlay not available',
  failedToLoadTaskOutput: 'Failed to load task output',
  noDetailsProvided: 'No details provided',
  deletedSource: 'Deleted source',
  failedToDeleteSource: 'Failed to delete source',
  deletedSkill: 'Deleted skill: {{name}}',
  invalidLink: 'Invalid link',
  restored: 'Restored',
  openingURL: 'Opening URL...',
  success: 'Success!',
  errorToast: 'Something went wrong. Please try again.',
  info: 'Here is some useful information.',
  doneExclamation: 'Done!',

  // Error Messages
  unknownError: 'Unknown error',
  networkRequestFailed: 'Network request failed',
  invalidCredentials: 'Invalid credentials',
  sessionExpired: 'Session expired',

  // Date/Time
  today: 'Today',
  yesterday: 'Yesterday',
  hoursAgo: '{{count}} hours ago',
  daysAgo: '{{count}} days ago',
  minutesAgo: '{{count}} minutes ago',
  secondsAgo: '{{count}} seconds ago',
  weeksAgo: '{{count}} weeks ago',
  monthsAgo: '{{count}} months ago',
  yearsAgo: '{{count}} years ago',
  justNow: 'Just now',
  atTime: 'at {{time}}',

  // Accessibility Labels
  goBack: 'Go back',
  goForward: 'Go forward',
  hideSidebar: 'Hide sidebar',
  showSidebar: 'Show sidebar',
  changeTodoState: 'Change todo state',
  openSettings: 'Open settings',
  mainNavigation: 'Main navigation',
  subNavigation: 'Sub navigation',

  // Dialog & Modal Text
  confirmAction: 'Confirm action',
  chooseBillingMethod: 'Choose billing method',

  // Onboarding
  welcomeToCraftAgents: 'Welcome to Craft Agents',
  getStarted: 'Get Started',

  // Settings
  language: 'Language',
  languageChanged: 'Language changed. UI will update momentarily.',
  selectLanguage: 'Select Language',

  // Language Names
  english: 'English',
  chinese: '中文 (Chinese)',

  // Keyboard Shortcuts
  pressKToSearch: 'Press ⌘K to search',

  // Settings Navigator
  settingsApp: 'App',
  settingsAppDescription: 'Appearance, notifications, billing',
  settingsWorkspace: 'Workspace',
  settingsWorkspaceDescription: 'Model, mode cycling, advanced',
  settingsPermissions: 'Permissions',
  settingsPermissionsDescription: 'Allowed commands in Explore mode',
  settingsShortcuts: 'Shortcuts',
  settingsShortcutsDescription: 'Keyboard shortcuts reference',
  settingsPreferences: 'Preferences',
  settingsPreferencesDescription: 'Your personal preferences',
  openInNewWindow: 'Open in New Window',

  // Preferences Page
  preferencesTitle: 'Preferences',
  basicInfo: 'Basic Info',
  basicInfoDescription: 'Help Craft Agent personalize responses to you.',
  nameLabel: 'Name',
  nameDescription: 'How Craft Agent should address you.',
  namePlaceholder: 'Your name',
  timezoneLabel: 'Timezone',
  timezoneDescription: 'Used for relative dates like "tomorrow" or "next week".',
  timezonePlaceholder: 'e.g., America/New_York',
  languageLabel: 'Language',
  languageDescription: 'Preferred language for Craft Agent\'s responses.',
  languagePlaceholder: 'e.g., English',
  locationTitle: 'Location',
  locationDescription: 'Enables location-aware responses like weather, local time, and regional context.',
  cityLabel: 'City',
  cityDescription: 'Your city for local information and context.',
  cityPlaceholder: 'e.g., New York',
  countryLabel: 'Country',
  countryDescription: 'Your country for regional formatting and context.',
  countryPlaceholder: 'e.g., USA',
  notesTitle: 'Notes',
  notesDescription: 'Free-form context that helps Craft Agent understand your preferences.',
  notesPlaceholder: 'Any additional context you\'d like Craft Agent to know...',
  editFile: 'Edit File',

  // Onboarding
  updateSettings: 'Update Settings',
  welcomeToCraftAgentsLong: 'Agents with the UX they deserve. Connect anything. Organize your sessions. Everything you need to do the work of your life!',
  updateBillingOrChangeSetup: 'Update billing or change your setup.',
  selectHowToPowerAgents: 'Select how you\'d like to power your AI agents.',
  claudeProOrMax: 'Claude Pro/Max',
  useClaudeSubscription: 'Use your Claude subscription for unlimited access.',
  anthropicApiKey: 'Anthropic API Key',
  payAsYouGo: 'Pay-as-you-go with your own API key.',
  customAnthropicCompatible: 'Custom / Anthropic Compatible',
  customAnthropicCompatibleDescription: 'Use a compatible endpoint and auth token.',
  recommended: 'Recommended',
  billingSetup: 'Billing Setup',
  billingSetupDescription: 'Add your credentials to continue.',
  claudeEmail: 'Claude Email',
  claudeEmailDescription: 'Your Claude account email address.',
  claudeEmailPlaceholder: 'you@example.com',
  apiKey: 'API Key',
  apiKeyDescription: 'Your Anthropic API key from the console.',
  apiKeyPlaceholder: 'sk-ant-...',
  baseUrl: 'Base URL',
  apiTimeoutMs: 'API timeout (ms)',
  modelOverride: 'Model override',
  authToken: 'Auth token',
  learnMoreAboutApiKeys: 'Learn more about API keys',
  credentialsStepSuccess: 'Credentials saved successfully!',
  credentialsStepError: 'Failed to save credentials. Please try again.',
  completionTitle: 'You\'re all set!',
  completionDescription: 'Your workspace is ready. Start by creating a new chat or exploring sources.',
  goToWorkspace: 'Go to Workspace',
  reauthRequired: 'Reauthentication Required',
  reauthDescription: 'Please sign in again to continue.',
  reauthButton: 'Sign In',

  // Keyboard Shortcuts Dialog
  keyboardShortcuts: 'Keyboard Shortcuts',
  keyboardShortcutsDescription: 'Quick reference for keyboard shortcuts',

  // Reset Confirmation Dialog
  resetWorkspace: 'Reset Workspace',
  resetWorkspaceDescription: 'This will delete all your sessions and settings. This action cannot be undone.',
  resetWorkspaceConfirm: 'Are you sure you want to reset your workspace?',
  resetButton: 'Reset',

  // Splash Screen
  loadingCraftAgents: 'Loading Craft Agents...',

  // App Menu
  file: 'File',
  view: 'View',
  window: 'Window',
  help: 'Help',
  quit: 'Quit',
  about: 'About',
  preferences: 'Preferences',
  hide: 'Hide',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  bringToFront: 'Bring All to Front',
  zoom: 'Zoom',
  speak: 'Speak',
  speech: 'Speech',
  startSpeaking: 'Start Speaking',
  stopSpeaking: 'Stop Speaking',
  checkForUpdates: 'Check for Updates...',

  // Chat Components
  authRequestTitle: 'Authentication Required',
  authRequestDescription: 'You need to authenticate to perform this action.',
  authenticate: 'Authenticate',
  emptyStateTitle: 'No messages yet',
  emptyStateDescription: 'Start a conversation by typing a message below.',
  emptyStateAction: 'Send your first message',

  // Panels
  sourcesPanel: 'Sources',
  sourcesPanelDescription: 'Manage your external data connections',
  skillsPanel: 'Skills',
  skillsPanelDescription: 'Custom skills and automations',
  noSourcesAvailable: 'No sources available',
  addSourceToGetStarted: 'Add a source to get started',
  noSkillsAvailable: 'No skills available',
  createSkillToGetStarted: 'Create a skill to get started',
  addYourFirstSource: 'Add your first source',
  addYourFirstSkill: 'Add your first skill',

  // Workspace Switcher
  switchWorkspace: 'Switch Workspace',
  noWorkspacesAvailable: 'No workspaces available',
  createNewWorkspace: 'Create New Workspace',

  // Setup Auth Banner
  setupRequired: 'Setup Required',
  setupRequiredDescription: 'Complete your setup to continue using Craft Agents.',
  completeSetup: 'Complete Setup',

  // Active Tasks Bar
  activeTasks: 'Active Tasks',
  noActiveTasks: 'No active tasks',

  // Attachment Preview
  attachment: 'Attachment',
  removeAttachment: 'Remove attachment',
  downloadAttachment: 'Download',

  // Input Components
  typeMessage: 'Type a message...',
  sendMessage: 'Send message',
  attachFile: 'Attach file',
  stopGenerating: 'Stop generating',
  interruptAndContinue: 'Interrupt and continue',
  permissionRequest: 'Permission Request',
  credentialRequest: 'Credential Request',
  allowCommand: 'Allow command',
  denyCommand: 'Deny command',
  allowAlways: 'Always allow',
  denyAlways: 'Always deny',
  provideCredential: 'Provide credential',
  skipCredential: 'Skip',

  // Session Files
  sessionFiles: 'Session Files',
  noFilesAttached: 'No files attached',
  attachFiles: 'Attach Files',

  // Session Metadata
  sessionMetadata: 'Session Details',
  createdAt: 'Created',
  lastModified: 'Last Modified',
  messageCount: 'Messages',

  // Settings Components
  search: 'Search',
  searchPlaceholder: 'Search...',
  clear: 'Clear',
  select: 'Select',
  selectOption: 'Select an option',
  noOptions: 'No options available',
  loading: 'Loading...',
  enabled: 'Enabled',
  disabled: 'Disabled',
  on: 'On',
  off: 'Off',
  yes: 'Yes',
  no: 'No',
  advanced: 'Advanced',
  basic: 'Basic',
  general: 'General',
  appearance: 'Appearance',
  behavior: 'Behavior',
  privacy: 'Privacy',
  security: 'Security',
  notifications: 'Notifications',
  integration: 'Integration',
  account: 'Account',
  billing: 'Billing',
  developer: 'Developer',
  experimental: 'Experimental',
  beta: 'Beta',

  // Data Tables
  name: 'Name',
  type: 'Type',
  status: 'Status',
  actions: 'Actions',
  description: 'Description',
  value: 'Value',
  url: 'URL',
  path: 'Path',
  version: 'Version',
  size: 'Size',
  date: 'Date',
  created: 'Created',
  modified: 'Modified',
  owner: 'Owner',
  permission: 'Permission',

  // Tools & Permissions
  tool: 'Tool',
  tools: 'Tools',
  command: 'Command',
  commands: 'Commands',
  allowed: 'Allowed',
  blocked: 'Blocked',
  pattern: 'Pattern',
  patterns: 'Patterns',
  endpoint: 'Endpoint',
  method: 'Method',
  scope: 'Scope',
  read: 'Read',
  write: 'Write',
  execute: 'Execute',
  none: 'None',

  // File Viewer
  fileViewerTitle: 'File Preview',
  fileViewerError: 'Error loading file',
  fileViewerTooLarge: 'File is too large to preview',
  downloadFile: 'Download file',
  copyPath: 'Copy path',

  // Markdown
  copyCode: 'Copy code',
  codeCopied: 'Code copied!',
  tableOfContents: 'Table of Contents',
  jumpToSection: 'Jump to section',

  // Data Table Pagination
  total: 'total',
  pageInfo: 'Page {{current}} of {{total}}',

  // Input Placeholders (additional)
  searchSources: 'Search sources...',
  filterFolders: 'Filter folders...',
  chooseWorkingDirectory: 'Choose working directory',
  workingDirectory: 'Working directory',
  addSourcesInSettings: 'Add sources in Settings',

  // EditPopover / 编辑弹窗
  describeWhatToChange: 'Describe what you\'d like to change...',
  editFile: 'Edit File',

  // Status Messages / 状态消息
  contemplating: 'Contemplating...',
  workingOnIt: 'Working on it...',
  connectingDots: 'Connecting dots...',
  mullingItOver: 'Mulling it over...',
  deepInThought: 'Deep in thought...',
  gettingThere: 'Getting there...',

  // Workspace UI / 工作空间界面
  selectWorkspace: 'Select workspace',
  createWorkspace: 'Create workspace',
  createWorkspaceDesc: 'Enter a name and choose where to store your workspace.',
  workspaceName: 'Workspace name',
  myWorkspace: 'My Workspace',
  location: 'Location',
  defaultLocation: 'Default location',
  underCraftAgentFolder: 'under .craft-agent folder',
  chooseLocation: 'Choose a location',
  pickPlaceForWorkspace: 'Pick a place to put your new workspace.',
  browse: 'Browse',
  creating: 'Creating...',
  createdWorkspace: 'Created workspace "{{name}}"',
  chooseExistingFolder: 'Choose existing folder',
  chooseExistingFolderDesc: 'Choose any folder to use as workspace.',
  noFolderSelected: 'No folder selected',
  opening: 'Opening...',
  open: 'Open',

  // Chat Display / 聊天显示
  responsePreview: 'Response Preview',
  turnDetails: 'Turn Details',
  showTechnicalDetails: 'Show technical details',
  hideTechnicalDetails: 'Hide technical details',
  openInNewWindow: 'Open in new window',

  // Session List / 会话列表
  newBadge: 'New',
  planBadge: 'Plan',
  conversationFlagged: 'Conversation flagged',
  addedToFlagged: 'Added to your flagged items',
  flagRemoved: 'Flag removed',
  removedFromFlagged: 'Removed from flagged items',
  undo: 'Undo',

  // Source Status / 来源状态
  needsAuth: 'Needs Auth',
  failed: 'Failed',
  notTested: 'Not Tested',
  disabled: 'Disabled',

} as const;
