/**
 * Onboarding Message Generator
 *
 * Generates contextual onboarding messages for new sessions based on workspace state.
 * These messages appear in the chat UI but don't trigger API calls until the user
 * sends their first real message.
 */

import { randomUUID } from 'crypto';
import type { StoredMessage } from './types.ts';
import type { FolderSourceConfig, SourceConnectionStatus } from '../sources/types.ts';

/**
 * Quick action definition for onboarding widgets
 */
export interface QuickAction {
  id: string;
  label: string;
  /** Message to send when clicked */
  prompt: string;
}

/**
 * Source that needs authentication
 */
export interface SourceNeedingAuth {
  slug: string;
  name: string;
}

/**
 * Onboarding context types - controls what messages/widgets are shown
 */
export type OnboardingContextType = 'add-source' | 'connect-sources' | 'welcome';

/**
 * Context for generating onboarding messages
 */
export interface OnboardingContext {
  /** All sources in the workspace */
  sources: FolderSourceConfig[];
  /** Whether this is the user's first session ever in this workspace */
  isFirstSession?: boolean;
  /** Workspace name for personalization */
  workspaceName?: string;
  /** Type of onboarding context - controls which messages are shown */
  context?: OnboardingContextType;
}

/**
 * Generate onboarding messages for a new session
 */
export function generateOnboardingMessages(context: OnboardingContext): StoredMessage[] {
  const messages: StoredMessage[] = [];
  const timestamp = Date.now();
  const onboardingType = context.context ?? 'welcome';

  // Analyze sources
  const sourcesNeedingAuth = context.sources.filter(
    (s) => s.connectionStatus === 'needs_auth' || (!s.isAuthenticated && requiresAuth(s))
  );
  const activeSources = context.sources.filter(
    (s) => s.connectionStatus === 'connected' || s.isAuthenticated
  );

  // Generate messages based on context type
  switch (onboardingType) {
    case 'add-source':
      // Focused onboarding for adding a new source
      messages.push({
        id: randomUUID(),
        type: 'onboarding',
        content: "I'll help you add a new source. Sources let me connect to external services like GitHub, Linear, Notion, or your own APIs.",
        timestamp,
        onboardingId: 'add-source-intro',
      });
      break;

    case 'connect-sources':
      // Focused onboarding for connecting existing sources
      if (sourcesNeedingAuth.length > 0) {
        const sourceNames = sourcesNeedingAuth.map((s) => s.name).join(', ');
        const sourceData: SourceNeedingAuth[] = sourcesNeedingAuth.map((s) => ({
          slug: s.slug,
          name: s.name,
        }));

        messages.push({
          id: randomUUID(),
          type: 'onboarding',
          content:
            sourcesNeedingAuth.length === 1
              ? `**${sourceNames}** needs authentication to connect.`
              : `${sourcesNeedingAuth.length} sources need authentication: ${sourceNames}`,
          timestamp,
          onboardingId: 'sources-auth',
          onboardingWidget: 'source-auth',
          onboardingData: { sources: sourceData },
        });
      } else {
        messages.push({
          id: randomUUID(),
          type: 'onboarding',
          content: "All your sources are connected! Would you like to add a new one?",
          timestamp,
          onboardingId: 'all-connected',
        });
      }
      break;

    case 'welcome':
    default:
      // Full welcome onboarding
      messages.push({
        id: randomUUID(),
        type: 'onboarding',
        content:
          "Welcome! I can help you work with your documents, connect external sources, and automate workflows. What would you like to do?",
        timestamp,
        onboardingId: 'welcome',
      });

      // Sources needing authentication hint
      if (sourcesNeedingAuth.length > 0) {
        const sourceNames = sourcesNeedingAuth.map((s) => s.name).join(', ');
        const sourceData: SourceNeedingAuth[] = sourcesNeedingAuth.map((s) => ({
          slug: s.slug,
          name: s.name,
        }));

        messages.push({
          id: randomUUID(),
          type: 'onboarding',
          content:
            sourcesNeedingAuth.length === 1
              ? `**${sourceNames}** needs authentication to connect.`
              : `${sourcesNeedingAuth.length} sources need authentication: ${sourceNames}`,
          timestamp: timestamp + 1,
          onboardingId: 'sources-auth',
          onboardingWidget: 'source-auth',
          onboardingData: { sources: sourceData },
        });
      }

      // Quick actions for welcome
      const quickActions: QuickAction[] = [];

      if (sourcesNeedingAuth.length > 0) {
        quickActions.push({
          id: 'connect-sources',
          label: 'Connect sources',
          prompt: 'Help me connect my sources',
        });
      }

      if (activeSources.length > 0) {
        // If there's a Craft space, offer to browse it
        const craftSource = activeSources.find(
          (s) => s.provider === 'craft' || s.name.toLowerCase().includes('craft')
        );
        if (craftSource) {
          quickActions.push({
            id: 'browse-documents',
            label: 'Browse documents',
            prompt: 'Show me my recent documents',
          });
        }
      }

      quickActions.push({
        id: 'what-can-you-do',
        label: 'What can you do?',
        prompt: 'What can you help me with?',
      });

      quickActions.push({
        id: 'add-source',
        label: 'Add a source',
        prompt: 'Help me add a new source',
      });

      messages.push({
        id: randomUUID(),
        type: 'onboarding',
        content: '',
        timestamp: timestamp + 2,
        onboardingId: 'quick-actions',
        onboardingWidget: 'quick-actions',
        onboardingData: { actions: quickActions },
      });
      break;
  }

  return messages;
}

/**
 * Check if a source requires authentication based on its config
 */
function requiresAuth(source: FolderSourceConfig): boolean {
  if (source.type === 'mcp' && source.mcp) {
    // Stdio sources don't need auth
    if (source.mcp.transport === 'stdio') {
      return false;
    }
    // HTTP/SSE sources need auth unless explicitly 'none'
    return source.mcp.authType !== 'none';
  }

  if (source.type === 'api' && source.api) {
    return source.api.authType !== 'none';
  }

  // Local sources don't need auth
  return false;
}

/**
 * Minimal interface for onboarding message formatting
 * Works with both StoredMessage (type field) and Message (role field)
 */
interface OnboardingMessageLike {
  type?: string;
  role?: string;
  content: string;
  onboardingWidget?: string;
  onboardingData?: Record<string, unknown>;
  onboardingSent?: boolean;
}

/**
 * Format onboarding messages as context for the first API call
 */
export function formatOnboardingContext(
  messages: OnboardingMessageLike[],
  triggeredAction?: string
): string {
  const onboardingMessages = messages.filter((m) =>
    (m.type === 'onboarding' || m.role === 'onboarding') && !m.onboardingSent
  );

  if (onboardingMessages.length === 0) {
    return '';
  }

  const lines: string[] = ['<session_onboarding>', 'The user started a new session and was shown:'];

  for (const msg of onboardingMessages) {
    if (msg.content) {
      lines.push(`- ${msg.content}`);
    }

    if (msg.onboardingWidget === 'quick-actions' && msg.onboardingData?.actions) {
      const actions = msg.onboardingData.actions as QuickAction[];
      const actionLabels = actions.map((a) => `[${a.label}]`).join(' ');
      lines.push(`- Quick actions: ${actionLabels}`);
    }

    if (msg.onboardingWidget === 'source-auth' && msg.onboardingData?.sources) {
      const sources = msg.onboardingData.sources as SourceNeedingAuth[];
      const sourceNames = sources.map((s) => s.name).join(', ');
      lines.push(`- Sources needing auth: ${sourceNames}`);
    }
  }

  if (triggeredAction) {
    lines.push('');
    lines.push(`The user clicked: "${triggeredAction}"`);
  }

  lines.push('</session_onboarding>');

  return lines.join('\n');
}
