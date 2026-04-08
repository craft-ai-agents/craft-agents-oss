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
    quit: 'Quit Craft Agents'
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
    sources: 'Sources',
    apis: 'APIs',
    mcps: 'MCPs',
    localFolders: 'Local Folders',
    skills: 'Skills',
    automations: 'Automations',
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
