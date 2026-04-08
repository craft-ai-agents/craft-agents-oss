// English language pack
export const enUS = {
  // Settings
  settings: {
    app: {
      label: 'App',
      description: 'Notifications and updates'
    },
    ai: {
      label: 'AI',
      description: 'Model, thinking, connections'
    },
    appearance: {
      label: 'Appearance',
      description: 'Theme, font, tool icons'
    },
    input: {
      label: 'Input',
      description: 'Send key, spell check'
    },
    workspace: {
      label: 'Workspace',
      description: 'Name, icon, working directory'
    },
    permissions: {
      label: 'Permissions',
      description: 'Explore mode rules'
    },
    labels: {
      label: 'Labels',
      description: 'Manage session labels'
    },
    server: {
      label: 'Server',
      description: 'Remote server access'
    },
    shortcuts: {
      label: 'Shortcuts',
      description: 'Keyboard shortcuts'
    },
    preferences: {
      label: 'Preferences',
      description: 'User preferences'
    },
    language: {
      label: 'Language',
      description: 'Interface language',
      enUS: 'English',
      zhCN: '中文'
    }
  },
  
  // Common
  common: {
    openInNewWindow: 'Open in New Window',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    confirm: 'Confirm',
    ok: 'OK',
    yes: 'Yes',
    no: 'No',
    newWindow: 'New Window',
    settings: 'Settings',
    help: 'Help',
    helpDocumentation: 'Help & Documentation',
    automations: 'Automations',
    debug: 'Debug',
    checkForUpdates: 'Check for Updates',
    installUpdate: 'Install Update',
    toggleDevTools: 'Toggle DevTools',
    quit: 'Quit Craft Agents',
    markAllRead: 'Mark All Read',
    configureStatuses: 'Configure Statuses',
    addNewLabel: 'Add New Label',
    editLabels: 'Edit Labels',
    deleteLabel: 'Delete Label',
    editViews: 'Edit Views',
    deleteView: 'Delete View',
    learnMoreAboutAPIs: 'Learn More about APIs',
    learnMoreAboutMCPs: 'Learn More about MCP',
    learnMoreAboutLocalFolders: 'Learn More about Local Folders',
    learnMoreAboutSources: 'Learn More about Sources',
    addSource: 'Add Source',
    addSkill: 'Add Skill',
    addAutomation: 'Add Automation',
    learnMoreAboutAutomations: 'Learn More about Automations',
    showInExplorer: 'Show in Explorer',
    deleteSource: 'Delete Source',
    deleteSkill: 'Delete Skill',
    noSkillsConfigured: 'No skills configured',
    skillsDescription: 'Skills are reusable instructions that teach your agent specialized behaviors.',
    noSourcesConfigured: 'No sources configured.',
    noApiSourcesConfigured: 'No API sources configured.',
    noMcpSourcesConfigured: 'No MCP sources configured.',
    noLocalFolderSourcesConfigured: 'No local folder sources configured.',
    sourcesDescription: 'Sources connect your agent to external data — MCP servers, REST APIs, and local folders.',
    managedByProject: 'Managed by project',
    authRequired: 'Auth Required',
    disconnected: 'Disconnected',
    notTested: 'Not Tested',
    disabled: 'Disabled',
    localFolder: 'local folder',
    retry: 'Retry',
    connectingToRemoteServer: 'Connecting to remote server',
    connectingToUrl: 'Connecting to {url}...',
    reconnectingToRemoteServer: 'Reconnecting to remote server',
    cannotConnectToRemoteServer: 'Cannot connect to remote server',
    connectionToRemoteServerLost: 'Connection to remote server lost',
    remoteServerConnectionStatus: 'Remote server connection status',
    retryInMs: 'retry in {ms}ms',
    retrying: 'retrying',
    attempt: 'attempt {number}',
    authenticationFailed: 'Authentication failed. Verify CRAFT_SERVER_TOKEN.',
    protocolMismatch: 'Protocol mismatch between client and server versions.',
    connectionToUrlTimedOut: 'Connection to {url} timed out. Server may be unreachable.',
    couldNotConnectToUrl: 'Could not connect to {url}. Is the remote server running?',
    webSocketClosedWithCode: 'WebSocket closed with code {code}{reason}.',
    waitingForRemoteServerConnection: 'Waiting for remote server connection.',
    when: 'When',
    then: 'Then',
    matching: 'matching',
    at: 'at',
    runTest: 'Run Test'
  },
  
  // Menu
  menu: {
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    resetZoom: 'Reset Zoom',
    toggleFocusMode: 'Toggle Focus Mode',
    toggleSidebar: 'Toggle Sidebar',
    minimize: 'Minimize',
    maximize: 'Maximize'
  },
  
  // Chat
  chat: {
    sendMessage: 'Send message',
    thinking: 'Thinking...',
    typing: 'Typing...',
    newChat: 'New Chat',
    saveChat: 'Save Chat',
    deleteChat: 'Delete Chat',
    renameChat: 'Rename Chat',
    shareChat: 'Share Chat',
    exportChat: 'Export Chat',
    clearChat: 'Clear Chat',
    chatHistory: 'Chat History',
    recentChats: 'Recent Chats',
    allChats: 'All Chats'
  },
  
  // AI
  ai: {
    model: 'Model',
    thinkingLevel: 'Thinking Level',
    connections: 'Connections',
    apiKey: 'API Key',
    temperature: 'Temperature',
    maxTokens: 'Max Tokens',
    topP: 'Top P',
    frequencyPenalty: 'Frequency Penalty',
    presencePenalty: 'Presence Penalty'
  },
  
  // Appearance
  appearance: {
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    font: 'Font',
    fontSize: 'Font Size',
    toolIcons: 'Tool Icons'
  },
  
  // Workspace
  workspace: {
    name: 'Name',
    icon: 'Icon',
    workingDirectory: 'Working Directory',
    browse: 'Browse',
    reset: 'Reset'
  },
  
  // Permissions
  permissions: {
    exploreMode: 'Explore Mode',
    allowCommands: 'Allow Commands',
    allowWrite: 'Allow Write',
    allowNetwork: 'Allow Network',
    allowSystem: 'Allow System'
  },
  
  // Labels
  labels: {
    manageLabels: 'Manage Labels',
    createLabel: 'Create Label',
    editLabel: 'Edit Label',
    deleteLabel: 'Delete Label',
    color: 'Color',
    name: 'Name'
  },
  
  // Server
  server: {
    remoteServer: 'Remote Server',
    enabled: 'Enabled',
    url: 'URL',
    port: 'Port',
    username: 'Username',
    password: 'Password'
  },
  
  // Actions
  actions: {
    newChat: 'New Chat',
    createANewChatSession: 'Create a new chat session',
    newChatInPanel: 'New Chat in Panel',
    createANewChatSessionInANewPanel: 'Create a new chat session in a new panel',
    general: 'General',
    openApplicationSettings: 'Open application settings',
    toggleTheme: 'Toggle Theme',
    switchBetweenLightAndDarkMode: 'Switch between light and dark mode',
    search: 'Search',
    openSearchPanel: 'Open search panel',
    showKeyboardShortcutsReference: 'Show keyboard shortcuts reference',
    openANewWindow: 'Open a new window',
    quit: 'Quit',
    quitTheApplication: 'Quit the application',
    navigation: 'Navigation',
    focusSidebar: 'Focus Sidebar',
    focusNavigator: 'Focus Navigator',
    focusChat: 'Focus Chat',
    focusNextZone: 'Focus Next Zone',
    goBack: 'Go Back',
    navigateToPreviousSession: 'Navigate to previous session',
    goForward: 'Go Forward',
    navigateToNextSession: 'Navigate to next session',
    navigateToPreviousSessionArrowKey: 'Navigate to previous session (arrow key)',
    navigateToNextSessionArrowKey: 'Navigate to next session (arrow key)',
    view: 'View',
    hideBothSidebarsForDistractionFreeWork: 'Hide both sidebars for distraction-free work',
    navigator: 'Navigator',
    clearSelection: 'Clear Selection',
    panel: 'Panel',
    focusNextPanel: 'Focus Next Panel',
    moveFocusToTheNextPanel: 'Move focus to the next panel',
    focusPreviousPanel: 'Focus Previous Panel',
    moveFocusToThePreviousPanel: 'Move focus to the previous panel',
    chat: 'Chat',
    stopProcessing: 'Stop Processing',
    cancelTheCurrentAgentTaskDoublePress: 'Cancel the current agent task (double-press)',
    cyclePermissionMode: 'Cycle Permission Mode',
    switchBetweenExploreAskAndExecuteModes: 'Switch between Explore, Ask, and Execute modes',
    nextSearchMatch: 'Next Search Match',
    previousSearchMatch: 'Previous Search Match'
  },
  
  // Shortcuts
  shortcuts: {
    keyboardShortcuts: 'Keyboard Shortcuts',
    editShortcuts: 'Edit Shortcuts',
    resetShortcuts: 'Reset Shortcuts',
    saveChanges: 'Save Changes'
  },
  
  // Input
  input: {
    sendKey: 'Send Key',
    spellCheck: 'Spell Check',
    enableSpellCheck: 'Enable Spell Check',
    whatWouldYouLike: 'What would you like to work on?',
    shiftTabSwitch: 'Use Shift + Tab to switch between Explore and Execute',
    typeAtMention: 'Type @ to mention files, folders, or skills',
    typeHashLabels: 'Type # to apply labels to this conversation',
    shiftReturnNewLine: 'Press Shift + Return to add a new line',
    cmdBToggleSidebar: 'Press {cmdKey} + B to toggle the sidebar',
    cmdDotFocusMode: 'Press {cmdKey} + . for focus mode'
  },
  
  // Session list
  sessionList: {
    today: 'Today',
    yesterday: 'Yesterday',
    allSessions: 'All Sessions',
    flagged: 'Flagged',
    archived: 'Archived',
    searchResults: 'Search Results',
    noSessions: 'No sessions found',
    searchedContent: 'Searched titles and message content'
  },
  
  // Reset dialog
  resetDialog: {
    title: 'Reset App',
    warning: 'This will <strong>permanently delete</strong>:',
    deleteItem1: 'All workspaces and their settings',
    deleteItem2: 'All credentials and API keys',
    deleteItem3: 'All preferences and session data',
    backupWarning: 'Back up any important data first!',
    undoWarning: 'This action cannot be undone.',
    confirmPrompt: 'To confirm, solve: {a} + {b} =',
    answerPlaceholder: 'Enter answer'
  },
  
  // Workspace picker
  workspacePicker: {
    title: 'Select Workspace',
    description: 'Choose a workspace on this server, or create a new one.',
    loading: 'Loading workspaces...',
    placeholder: 'New workspace name',
    creating: 'Creating...',
    createButton: 'Create Workspace'
  },
  
  // Sidebar
  sidebar: {
    allSessions: 'All Sessions',
    flagged: 'Flagged',
    archived: 'Archived',
    labels: 'Labels',
    views: 'Views',
    sources: 'Sources',
    apis: 'APIs',
    mcps: 'MCPs',
    localFolders: 'Local Folders',
    skills: 'Skills',
    allSkills: 'All Skills',
    automations: 'Automations',
    allAutomations: 'All Automations',
    scheduled: 'Scheduled',
    eventBased: 'Event-based',
    agentic: 'Agentic',
    settings: 'Settings',
    whatsNew: 'What\'s New'
  },

  // Session Statuses
  statuses: {
    backlog: 'Backlog',
    todo: 'Todo',
    needsReview: 'Needs Review',
    done: 'Done',
    cancelled: 'Cancelled'
  },

  // Label Categories
  labelCategories: {
    content: 'Content',
    design: 'Design',
    research: 'Research',
    writing: 'Writing',
    development: 'Development',
    automation: 'Automation',
    bug: 'Bug',
    code: 'Code',
    priority: 'Priority',
    project: 'Project'
  },

  // UI Elements
  ui: {
    allSessions: 'All Sessions',
    filterChats: 'Filter Chats',
    searchStatusesAndLabels: 'Search statuses & labels...',
    statuses: 'Statuses',
    group: 'Group',
    search: 'Search',
    share: 'Share',
    flag: 'Flag',
    archive: 'Archive',
    rename: 'Rename',
    regenerateTitle: 'Regenerate Title',
    openInNewPanel: 'Open in New Panel',
    openInNewWindow: 'Open in New Window',
    showInExplorer: 'Show in Explorer',
    copyPath: 'Copy Path',
    delete: 'Delete',
    filterStatuses: 'Filter statuses...',
    unflag: 'Unflag',
    unarchive: 'Unarchive',
    markAsUnread: 'Mark as Unread',
    sendToWorkspace: 'Send to Workspace...',
    openInBrowser: 'Open in Browser',
    copyLink: 'Copy Link',
    updateShare: 'Update Share',
    stopSharing: 'Stop Sharing',
    shared: 'Shared',
    noStatusFound: 'No status found',
    explore: 'Explore',
    askToEdit: 'Ask to Edit',
    execute: 'Execute',
    ask: 'Ask',
    info: 'Info',
    date: 'Date'
  },

  // Onboarding
  onboarding: {
    welcome: {
      title: 'Welcome to Craft Agents',
      description: 'Agents with the UX they deserve. Connect anything. Organize your sessions. Everything you need to do the work of your life!',
      existingTitle: 'Update Settings',
      existingDescription: 'Update your API connection or change your setup.',
      checking: 'Checking...',
      getStarted: 'Get Started'
    }
  }
};
