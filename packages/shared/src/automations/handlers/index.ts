/**
 * Automation Handlers - Re-exports for convenience
 */

export type {
  AutomationHandler,
  PromptHandlerOptions,
  EventLogHandlerOptions,
  PromptProcessingResult,
  AutomationsConfigProvider,
} from './types.ts';

export { PromptHandler } from './prompt-handler.ts';
export { EventLogHandler } from './event-log-handler.ts';
export { WebhookHandler, type WebhookHandlerOptions } from './webhook-handler.ts';
export {
  KnowledgeHandler,
  type KnowledgeHandlerOptions,
  type KnowledgeActionExecutor,
  type KnowledgeActionExecutorContext,
  type KnowledgeActionExecutorResult,
  type CloudRunSubmitExecutor,
  type CloudRunSubmitExecutorContext,
  type CloudRunSubmitExecutorResult,
} from './knowledge-handler.ts';
