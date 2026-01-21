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

  // Accessibility Labels
  goBack: 'Go back',
  goForward: 'Go forward',
  hideSidebar: 'Hide sidebar',
  showSidebar: 'Show sidebar',
  changeTodoState: 'Change todo state',
  openSettings: 'Open settings',

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

} as const;
