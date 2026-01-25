/**
 * Slack Integration Types
 *
 * Core types for Slack message handling, session management,
 * and multi-account credential storage within Vesper's credential system.
 */

/**
 * Connection status for Slack accounts.
 */
export type SlackConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Error codes for categorizing Slack errors.
 * Used to generate user-friendly error messages and enable recovery strategies.
 */
export enum SlackErrorCode {
  AUTH_FAILED = 'auth_failed',
  TOKEN_EXPIRED = 'token_expired',
  RATE_LIMITED = 'rate_limited',
  CHANNEL_NOT_FOUND = 'channel_not_found',
  USER_NOT_FOUND = 'user_not_found',
  PERMISSION_DENIED = 'permission_denied',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown',
}

/**
 * Error type for Slack operations.
 *
 * Provides structured error information with recovery guidance.
 */
export interface SlackError {
  /** Error code for categorization */
  code: SlackErrorCode;

  /** Human-readable error message */
  message: string;

  /** True if the error can be retried automatically */
  recoverable: boolean;

  /** Optional: seconds to wait before retrying (for rate limiting) */
  retryAfter?: number;
}

/**
 * Slack user profile information.
 *
 * Subset of Slack's user.profile object with commonly used fields.
 */
export interface SlackUserProfile {
  /** Display name (may differ from username) */
  displayName?: string;

  /** User's real name */
  realName?: string;

  /** Email address */
  email?: string;

  /** 48x48 profile image URL */
  image48?: string;

  /** 72x72 profile image URL */
  image72?: string;
}

/**
 * Slack user representation.
 *
 * Corresponds to Slack's user object with relevant fields.
 */
export interface SlackUser {
  /** Unique user ID (e.g., "U024BE7LH") */
  id: string;

  /** Username (e.g., "bobby") */
  name: string;

  /** Real name (e.g., "Bobby Tables") */
  realName?: string;

  /** Email address */
  email?: string;

  /** Profile information */
  profile?: SlackUserProfile;

  /** True if this is a bot user */
  isBot?: boolean;

  /** True if user has been deleted */
  deleted?: boolean;
}

/**
 * Slack channel representation.
 *
 * Covers public channels, private channels, DMs, and multi-party DMs.
 */
export interface SlackChannel {
  /** Unique channel ID (e.g., "C024BE91L") */
  id: string;

  /** Channel name (without # prefix) */
  name: string;

  /** True if private channel/group */
  isPrivate: boolean;

  /** True if direct message (1:1) */
  isIm: boolean;

  /** True if multi-party direct message */
  isMpim?: boolean;

  /** True if channel has been archived */
  isArchived?: boolean;
}

/**
 * File attachment in a Slack message.
 *
 * Represents uploaded files, images, and documents.
 */
export interface SlackFile {
  /** Unique file ID */
  id: string;

  /** File name with extension */
  name: string;

  /** MIME type (e.g., "image/png", "application/pdf") */
  mimetype: string;

  /** File size in bytes */
  size: number;

  /** Public download URL (if shared externally) */
  url?: string;

  /** Private download URL (requires auth) */
  urlPrivate?: string;
}

/**
 * Slack message representation.
 *
 * Core message structure from Slack's chat.postMessage and events API.
 */
export interface SlackMessage {
  /** Message timestamp (unique ID within a channel) */
  ts: string;

  /** Plain text message content */
  text: string;

  /** Channel ID where message was sent */
  channel: string;

  /** User ID of sender (undefined for bot messages) */
  user?: string;

  /** Bot ID if message was sent by a bot */
  botId?: string;

  /** Thread timestamp (if message is part of a thread) */
  threadTs?: string;

  /** User ID of thread parent author */
  parentUserId?: string;

  /** File attachments */
  files?: SlackFile[];

  /** Slack Block Kit blocks for rich formatting */
  blocks?: unknown[];

  /** Message subtype (e.g., "bot_message", "file_share") */
  subtype?: string;

  /** Edit metadata if message was edited */
  edited?: { user: string; ts: string };
}

/**
 * Inbound message from Slack to Vesper.
 *
 * Enriched with account context and routing metadata.
 */
export interface SlackInboundMessage extends SlackMessage {
  /** Vesper account ID for multi-account support */
  accountId: string;

  /** Slack workspace team ID */
  teamId: string;

  /** Human-readable channel name (e.g., "#general") */
  channelName?: string;

  /** Human-readable username */
  userName?: string;

  /** User's email address */
  userEmail?: string;

  /** True if bot was @mentioned in this message */
  wasMentioned: boolean;

  /** True if message is a reply in a thread */
  isThreadReply: boolean;
}

/**
 * Outbound message from Vesper to Slack.
 *
 * Payload for sending messages via chat.postMessage.
 */
export interface SlackOutboundMessage {
  /** Channel ID to send message to */
  channel: string;

  /** Plain text message content */
  text: string;

  /** Thread timestamp (to reply in a thread) */
  threadTs?: string;

  /** Slack Block Kit blocks for rich formatting */
  blocks?: unknown[];

  /** Automatically unfurl links */
  unfurlLinks?: boolean;

  /** Automatically unfurl media */
  unfurlMedia?: boolean;
}

/**
 * Slack account configuration.
 *
 * Per-account settings for behavior, permissions, and routing.
 * Stored in config.json, credentials stored separately in credentials.enc.
 */
export interface SlackAccountConfig {
  /** Unique account identifier (generated by Vesper) */
  accountId: string;

  /** Account enabled/disabled toggle */
  enabled: boolean;

  /** Optional human-friendly account name */
  name?: string;

  /** Slack workspace team ID */
  teamId?: string;

  /** Slack workspace team name */
  teamName?: string;

  /** Bot user ID in the workspace */
  botUserId?: string;

  /** Connection mode: 'socket' (Socket Mode) or 'http' (Events API) */
  mode: 'socket' | 'http';

  // Access control
  /** DM policy: 'disabled' (ignore), 'pairing' (paired sessions only), 'open' (anyone) */
  dmPolicy: 'disabled' | 'pairing' | 'open';

  /** Group policy: 'closed' (allowlist only), 'open' (all channels) */
  groupPolicy: 'closed' | 'open';

  /** Channel allowlist (IDs or names) - only respond in these channels */
  channelAllowlist?: string[];

  /** Channel denylist (IDs or names) - never respond in these channels */
  channelDenylist?: string[];

  /** User allowlist (IDs or emails) - only respond to these users */
  userAllowlist?: string[];

  // Threading
  /** Reply behavior: 'off' (no replies), 'first' (first msg only), 'all' (all replies) */
  replyToMode: 'off' | 'first' | 'all';

  /** Require @mention to trigger bot response */
  requireMention?: boolean;
}

/**
 * Slack service runtime state.
 *
 * Tracks active connection status and errors for each account.
 */
export interface SlackServiceState {
  /** Account ID this state belongs to */
  accountId: string;

  /** Current connection status */
  status: SlackConnectionStatus;

  /** Workspace team ID */
  teamId?: string;

  /** Workspace team name */
  teamName?: string;

  /** Bot user ID */
  botUserId?: string;

  /** Most recent error (if any) */
  error?: SlackError;

  /** Timestamp when connection was established (milliseconds since epoch) */
  connectedAt?: number;
}

/**
 * Thread context for routing and reply logic.
 *
 * Determines how to handle incoming messages and where to send replies.
 */
export interface SlackThreadContext {
  /** Original thread timestamp from incoming message (if in a thread) */
  incomingThreadTs?: string;

  /** Timestamp of the current message */
  messageTs: string;

  /** True if message is a reply in an existing thread */
  isThreadReply: boolean;

  /** Thread timestamp to use when replying */
  replyToId: string;

  /** Vesper message thread ID for tracking conversation flow */
  messageThreadId?: string;
}

/**
 * Composite key for identifying a unique Slack conversation context.
 *
 * Used by session mapper to create deterministic session IDs.
 * Same account + team + channel + thread = same sessionId (context preserved)
 */
export interface SlackSessionKey {
  /** Vesper account ID */
  accountId: string;

  /** Slack workspace team ID */
  teamId: string;

  /** Channel ID where conversation is happening */
  channelId: string;

  /** Thread timestamp (undefined for top-level channel messages) */
  threadTs?: string;
}

/**
 * Permission directive parsed from Slack message.
 *
 * Allows users to override permission mode via text directives like "/ask" or "/allow-all".
 */
export interface SlackPermissionDirective {
  /** Permission mode extracted from message */
  mode: 'safe' | 'ask' | 'allow-all';

  /** Message text with directive removed */
  cleanedText: string;
}
