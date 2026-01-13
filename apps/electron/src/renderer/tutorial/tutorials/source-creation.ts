/**
 * Source Creation Tutorial
 *
 * Guides users through adding their first source and using it in a chat.
 * Triggered when workspace has no sources.
 *
 * Flow:
 * 1. Click Sources in sidebar
 * 2. Click + button to add source
 * 3. Type in chat input (e.g., "connect to gmail") - sending disabled
 * 4. Click send button to submit
 * 5. Wait for permission banner, explain permissions with "Got it" button
 * 6. Click permission mode dropdown
 * 7. Select "Auto" mode
 * 8. Click Allow button
 * 9. Click Sign in with Google (OAuth)
 * 10. Click Cloud Services to see the new source
 * 11. Explain the source details with "Got it!" button
 * 12. Click New Chat to start a conversation
 * 13. Click source selector button
 * 14. Select the Gmail source
 * 15. Type "list my last 3 emails" - sending disabled
 * 16. Click send to complete
 */

import type { TutorialDefinition } from '../types'

export const sourceCreationTutorial: TutorialDefinition = {
  id: 'source-creation',
  name: 'Adding Your First Source',
  trigger: {
    type: 'condition',
    // Condition is checked in TutorialContext based on sources.length === 0
    check: () => true,
  },
  steps: [
    {
      id: 'click-sources',
      target: '[data-tutorial="sources-nav"]',
      title: 'Your Sources',
      description:
        'Sources connect Craft Agents to your tools, files, and services. Click here to see your integrations.',
      position: 'right',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
    },
    {
      id: 'click-add',
      target: '[data-tutorial="add-source-button"]',
      title: 'Add a Source',
      description:
        'Click the + button to add your first source. You can connect local folders, cloud services, or MCP servers.',
      position: 'bottom',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
      delay: 300, // Wait for navigation to complete
    },
    {
      id: 'type-in-chat',
      target: '[data-tutorial="chat-input"]',
      title: 'Ask for Connections',
      description:
        'Just tell Craft Agents what you want to connect! Type "connect to gmail" in the input field.',
      position: 'top',
      completionEvent: 'input_match',
      expectedInput: 'connect to gmail',
      inputMatchDelay: 2000, // Wait 2 seconds after typing before advancing
      showArrow: true,
      spotlightPadding: 12,
      spotlightRadius: 8,
      delay: 500, // Wait for chat panel to open
      disableSend: true, // Prevent eager sending - guide to send button next
    },
    {
      id: 'click-send',
      target: '[data-tutorial="send-button"]',
      title: 'Send Your Request',
      description:
        'Now click the send button to submit your request.',
      position: 'left',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
    },
    {
      id: 'explain-permissions',
      target: '[data-tutorial="permission-banner"]',
      title: 'Permission Request',
      description:
        'Craft Agents asks permission before taking actions. You can:\n\n• Allow – Approve this one action\n• Always Allow – Auto-approve similar actions\n• Deny – Block this action\n\nFor source setup, these actions are safe. Let\'s enable Auto mode to speed things up.',
      position: 'top',
      completionEvent: 'appear',
      nextButton: 'Got it, let\'s continue',
      showArrow: true,
      spotlightPadding: 8,
      spotlightRadius: 8,
    },
    {
      id: 'click-permission-dropdown',
      target: '[data-tutorial="permission-mode-dropdown"]',
      title: 'Switch to Auto Mode',
      description:
        'Click here to open the permission mode menu.',
      position: 'top',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
      delay: 200,
    },
    {
      id: 'select-auto-mode',
      target: '[data-tutorial="permission-mode-allow-all"]',
      title: 'Select Auto Mode',
      description:
        'Click "Auto" to automatically approve actions. This is safe for source creation and speeds up the setup.',
      position: 'right',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 4,
      spotlightRadius: 6,
      delay: 200, // Wait for dropdown to open
    },
    {
      id: 'click-allow-button',
      target: '[data-tutorial="permission-allow-button"]',
      title: 'Approve This Action',
      description:
        'Now click "Allow" to approve this permission request and continue with the setup.',
      position: 'top',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
      delay: 300, // Wait for dropdown to close
    },
    {
      id: 'click-oauth-button',
      target: '[data-tutorial="oauth-sign-in-button"]',
      title: 'Authenticate with Google',
      description:
        'Click "Sign in with Google" to connect your account. A browser window will open for secure authentication.',
      position: 'top',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 8,
      spotlightRadius: 8,
      delay: 500, // Short delay, rely on MutationObserver to find the element when it appears
      waitForElement: true, // Wait indefinitely - depends on agent response
    },
    // Post-OAuth steps: Explore source and use it in a chat
    {
      id: 'click-cloud-services',
      target: '[data-tutorial="cloud-services-nav"]',
      title: 'Explore Your Sources',
      description:
        'Your Gmail source is now connected! Click "Cloud Services" to see it.',
      position: 'right',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
      delay: 2000, // Wait for OAuth to complete and source to appear
    },
    {
      id: 'explain-source',
      target: '[data-tutorial="source-item-first"]',
      title: 'Your Connected Source',
      description:
        'This is your Gmail source. It shows the connection status, type, and available tools. You can click on any source to see its details and manage permissions.',
      position: 'right',
      completionEvent: 'custom',
      nextButton: 'Got it!',
      showArrow: true,
      spotlightPadding: 8,
      spotlightRadius: 8,
      delay: 500,
    },
    {
      id: 'click-new-chat',
      target: '[data-tutorial="new-chat-button"]',
      title: 'Start a Conversation',
      description:
        'Now let\'s use your new source! Click "New Chat" to start a conversation.',
      position: 'right',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
    },
    {
      id: 'click-source-selector',
      target: '[data-tutorial="source-selector-button"]',
      title: 'Enable Your Source',
      description:
        'Click the sources button to choose which sources to use in this chat.',
      position: 'top',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
      delay: 500,
    },
    {
      id: 'select-gmail-source',
      target: '[data-tutorial="source-dropdown-item-first"]',
      title: 'Select Gmail',
      description:
        'Click on your Gmail source to enable it for this conversation.',
      position: 'left',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 4,
      spotlightRadius: 6,
      delay: 200,
    },
    {
      id: 'type-query',
      target: '[data-tutorial="chat-input"]',
      title: 'Try It Out!',
      description:
        'Type "list my last 3 emails" to see your source in action.',
      position: 'top',
      completionEvent: 'input_match',
      expectedInput: 'list my last 3 emails',
      inputMatchDelay: 2000,
      showArrow: true,
      spotlightPadding: 12,
      spotlightRadius: 8,
      delay: 300,
      disableSend: true, // Prevent sending before guided to do so
    },
    {
      id: 'click-send-final',
      target: '[data-tutorial="send-button"]',
      title: 'Send Your Request',
      description:
        'Click send to ask Gmail for your recent emails!',
      position: 'left',
      completionEvent: 'click',
      showArrow: true,
      spotlightPadding: 6,
      spotlightRadius: 8,
    },
  ],
  onComplete: () => {
    console.log('[Tutorial] Source creation tutorial completed')
  },
  onSkip: () => {
    console.log('[Tutorial] Source creation tutorial skipped')
  },
}
