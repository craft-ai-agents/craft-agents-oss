/**
 * Hook Handlers - Re-exports for convenience
 */

export type {
  HookHandler,
  CommandHandlerOptions,
  PromptHandlerOptions,
  EventLogHandlerOptions,
  CommandExecutionResult,
  PromptProcessingResult,
  HooksConfigProvider,
} from './types.ts';

export { CommandHandler } from './command-handler.ts';
export { PromptHandler } from './prompt-handler.ts';
export { EventLogHandler } from './event-log-handler.ts';
