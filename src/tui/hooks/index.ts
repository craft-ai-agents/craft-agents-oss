/**
 * TUI Hooks - Re-exports all hooks from subfolders
 *
 * Organized by UI area:
 * - modals/: Modal state and handler hooks
 * - input/: Input handling hooks (commands, mentions, history)
 * - core/: Core functionality hooks (agent, resize, elapsed time)
 */

// Modal hooks
export { useModalState } from './modals/useModalState.ts';
export type { ModalName, UseModalStateResult } from './modals/useModalState.ts';

export { useWorkspaceHandlers } from './modals/useWorkspaceHandlers.ts';
export type { UseWorkspaceHandlersProps, UseWorkspaceHandlersResult } from './modals/useWorkspaceHandlers.ts';

export { useAgentMenuHandlers } from './modals/useAgentMenuHandlers.ts';
export type {
  UseAgentMenuHandlersProps,
  UseAgentMenuHandlersResult,
  AgentActionResult,
  ToolGroup,
} from './modals/useAgentMenuHandlers.ts';

export { useSettingsHandlers } from './modals/useSettingsHandlers.ts';
export type { UseSettingsHandlersProps, UseSettingsHandlersResult } from './modals/useSettingsHandlers.ts';

// Input hooks
export { useCommands } from './input/useCommands.ts';
export type { UseCommandsProps, CommandResult } from './input/useCommands.ts';

export { useMentionHandler } from './input/useMentionHandler.ts';
export type { UseMentionHandlerProps, MentionResult } from './input/useMentionHandler.ts';

export { useHistory } from './input/useHistory.ts';

// Core hooks
export { useAgent } from './core/useAgent.ts';

export { useResize } from './core/useResize.ts';

export { useElapsedTime } from './core/useElapsedTime.ts';
