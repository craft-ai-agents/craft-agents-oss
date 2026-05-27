/**
 * Automation Handlers - Re-exports for convenience
 */

export type {
  AutomationHandler,
  PromptHandlerOptions,
  EventLogHandlerOptions,
  RetentionHandlerOptions,
  RetentionResult,
  PromptProcessingResult,
  AutomationsConfigProvider,
} from './types.ts';

export { PromptHandler } from './prompt-handler.ts';
export { EventLogHandler } from './event-log-handler.ts';
export { WebhookHandler, type WebhookHandlerOptions } from './webhook-handler.ts';
export { RetentionHandler } from './retention-handler.ts';
