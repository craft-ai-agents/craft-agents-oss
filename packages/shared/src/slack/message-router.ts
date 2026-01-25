/**
 * Slack Message Router
 *
 * Routes incoming Slack messages to Vesper sessions with access control.
 */

import type {
  SlackInboundMessage,
  SlackAccountConfig,
  SlackSessionKey,
} from './types';
import { buildSessionKey, sessionKeyToString } from './session-mapper';
import { parsePermissionDirective } from './directive-parser';

export interface MessageRouteResult {
  shouldProcess: boolean;
  reason?: string;
  sessionKey?: string;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  cleanedText?: string;
  pairingRequired?: boolean;
  pairingCode?: string;
}

export interface MessageRouterConfig {
  accountConfig: SlackAccountConfig;
  botUserId?: string;
}

/**
 * Check if a channel is allowed by the policy
 */
function isChannelAllowed(
  channelId: string,
  channelName: string | undefined,
  config: SlackAccountConfig
): boolean {
  const { groupPolicy, channelAllowlist, channelDenylist } = config;

  // Check denylist first
  if (channelDenylist?.length) {
    if (channelDenylist.includes(channelId)) return false;
    if (channelName && channelDenylist.includes(channelName)) return false;
  }

  // Open policy: allow unless explicitly denied
  if (groupPolicy === 'open') {
    return true;
  }

  // Closed policy: require explicit allow
  if (!channelAllowlist?.length) {
    return false;
  }

  if (channelAllowlist.includes('*')) return true;
  if (channelAllowlist.includes(channelId)) return true;
  if (channelName && channelAllowlist.includes(channelName)) return true;

  return false;
}

/**
 * Check if a user is allowed
 */
function isUserAllowed(
  userId: string,
  userName: string | undefined,
  userEmail: string | undefined,
  config: SlackAccountConfig
): boolean {
  const { userAllowlist } = config;

  if (!userAllowlist?.length) return true;
  if (userAllowlist.includes('*')) return true;
  if (userAllowlist.includes(userId)) return true;
  if (userName && userAllowlist.includes(userName)) return true;
  if (userEmail && userAllowlist.includes(userEmail)) return true;

  return false;
}

/**
 * Check if message should be processed based on mention requirements
 */
function passesMentionGate(
  message: SlackInboundMessage,
  config: SlackAccountConfig,
  botUserId?: string
): boolean {
  // DMs don't require mentions
  if (message.channelName === 'directmessage') return true;

  // If mention not required, pass
  if (!config.requireMention) return true;

  // Check if bot was mentioned
  if (message.wasMentioned) return true;

  // Check if this is a reply to the bot
  if (message.isThreadReply && botUserId && message.parentUserId === botUserId) {
    return true;
  }

  return false;
}

/**
 * Route an inbound Slack message
 *
 * Applies access control checks and returns routing decision.
 */
export function routeSlackMessage(
  message: SlackInboundMessage,
  config: MessageRouterConfig
): MessageRouteResult {
  const { accountConfig, botUserId } = config;

  // Skip if account is disabled
  if (!accountConfig.enabled) {
    return { shouldProcess: false, reason: 'Account disabled' };
  }

  // Skip bot messages (including our own)
  if (message.botId) {
    return { shouldProcess: false, reason: 'Bot message' };
  }

  // Skip messages from ourselves
  if (message.user === botUserId) {
    return { shouldProcess: false, reason: 'Own message' };
  }

  const isDm = message.channelName === 'directmessage';

  // DM Policy check
  if (isDm) {
    if (accountConfig.dmPolicy === 'disabled') {
      return { shouldProcess: false, reason: 'DMs disabled' };
    }

    if (accountConfig.dmPolicy === 'pairing') {
      const userAllowed = isUserAllowed(
        message.user ?? '',
        message.userName,
        message.userEmail,
        accountConfig
      );

      if (!userAllowed) {
        return {
          shouldProcess: false,
          reason: 'Pairing required',
          pairingRequired: true,
        };
      }
    }
    // 'open' policy allows all DMs
  } else {
    // Channel access check
    if (!isChannelAllowed(message.channel, message.channelName, accountConfig)) {
      return { shouldProcess: false, reason: 'Channel not allowed' };
    }

    // User access check
    if (!isUserAllowed(message.user ?? '', message.userName, message.userEmail, accountConfig)) {
      return { shouldProcess: false, reason: 'User not allowed' };
    }

    // Mention gate check
    if (!passesMentionGate(message, accountConfig, botUserId)) {
      return { shouldProcess: false, reason: 'Mention required' };
    }
  }

  // Parse permission directive
  const { mode, cleanedText } = parsePermissionDirective(message.text);

  // Build session key
  const sessionKeyObj = buildSessionKey(message);
  const sessionKey = sessionKeyToString(sessionKeyObj);

  return {
    shouldProcess: true,
    sessionKey,
    permissionMode: mode,
    cleanedText,
  };
}

/**
 * Create a message router instance
 */
export function createMessageRouter(config: MessageRouterConfig) {
  return {
    route: (message: SlackInboundMessage) => routeSlackMessage(message, config),

    updateConfig: (newConfig: Partial<MessageRouterConfig>) => {
      Object.assign(config, newConfig);
    },
  };
}
