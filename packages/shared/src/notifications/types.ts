/**
 * Notification bell entry — persisted per-workspace at
 * `<workspaceRoot>/notifications.json` and broadcast via
 * `notifications:updated` (see `protocol/channels.ts`).
 *
 * Sources today: pulses (Pulse decisions of `notify_user` / `ask_user`).
 * Future: arbitrary system notifications.
 */
export interface NotificationEntry {
  id: string;
  workspaceId: string;
  source: 'pulse' | 'system';
  title?: string;
  message: string;
  urgency: 'low' | 'normal' | 'high';
  pulseId?: string;
  goalSlug?: string;
  workflowRunId?: string;
  workflowSlug?: string;
  /** True when the entry asks for a user reply (Pulse `ask_user`). */
  awaitingResponse?: boolean;
  /** Populated when the user replied to an `awaitingResponse` entry. */
  userResponse?: string;
  createdAt: string;
  acknowledgedAt?: string;
  clearedAt?: string;
}
