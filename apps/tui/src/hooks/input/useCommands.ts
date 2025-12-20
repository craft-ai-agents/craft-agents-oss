import { useCallback } from 'react';
import { homedir } from 'os';
import { MODELS } from '@craft-agent/shared/config';
import {
  getWorkspaces,
  removeWorkspace,
  listPlanFiles,
  type Workspace,
  type Session,
} from '@craft-agent/shared/config';
import { formatPreferencesDisplay } from '@craft-agent/shared/config';
import { resolveCommand } from '../../utils/filtering.ts';
import { readClipboard, readFileAttachment, type FileAttachment } from '@craft-agent/shared/utils';
import { getCurrentVersion } from '@craft-agent/shared/version';
import type { ModalName } from '../modals/useModalState.ts';
import type { Message } from '../../components/Messages.tsx';
import type { SubAgentDefinition } from '@craft-agent/shared/agents';
import { PLAN_MODE_ENTER_MESSAGE, PLAN_MODE_ENTER_PROMPT } from '@craft-agent/shared/agents';
import type { TokenUsage } from '../core/useAgent.ts';
import { formatContextDisplay } from '../../utils/context-formatter.ts';

/**
 * Result of command execution
 */
export interface CommandResult {
  /** Whether the command was handled (false = not a command, pass to message handler) */
  handled: boolean;
  /** Optional message to display */
  message?: { content: string; type: Message['type'] };
  /** Optional message to send to the agent */
  sendToAgent?: string;
}

/**
 * Tool group structure for /tools command
 */
export interface ToolGroup {
  name: string;
  tools: { name: string; description?: string }[];
}

/**
 * Props for useCommands hook
 */
export interface UseCommandsProps {
  // Global context
  workspace: Workspace;
  session: Session;
  model: string;
  setModel: (model: string) => void;
  setWorkspace: (workspace: Workspace) => void;
  startNewSession: () => Session;
  /** Clears messages and token usage in current session, resets UI state */
  resetSession: () => void;
  tokenUsage: TokenUsage;

  // Modal control
  openModal: (name: ModalName) => void;

  // Attachment handling
  pendingAttachments: FileAttachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<FileAttachment[]>>;

  // Agent operations
  availableAgents: string[];
  activeAgentName: string | null;
  activeAgentDefinition: SubAgentDefinition | null;
  activateAgent: (name: string) => Promise<boolean | 'pending_auth'>;
  deactivateAgent: () => void;
  reloadAgent: () => Promise<boolean>;
  resetAgent: () => Promise<boolean>;
  refreshAgents: () => Promise<string[] | { error: string }>;
  fetchTools: () => Promise<ToolGroup[]>;

  // Plan mode operations
  planMode: boolean;
  approvePlan: () => void;
  cancelPlan: () => void;
  // Craft Agents plan mode (uses CraftAskUserQuestion, blocks API calls during planning)
  startCraftPlanning: () => void;
  cancelCraftPlanning: () => void;

  // Exit handler
  exitApp: () => void;
}

/**
 * Hook that handles all slash command processing.
 *
 * Extracts ~400 lines of command handling logic from SessionContainer.
 *
 * Usage:
 * ```tsx
 * const { handleCommand } = useCommands({ workspace, session, ... });
 *
 * // In submit handler
 * if (input.startsWith('/')) {
 *   const result = await handleCommand(input);
 *   if (result.handled) {
 *     if (result.message) {
 *       addLocalMessage(result.message.content, result.message.type);
 *     }
 *     return;
 *   }
 * }
 * ```
 */
export function useCommands(props: UseCommandsProps) {
  const {
    workspace,
    session,
    model,
    setModel,
    setWorkspace,
    startNewSession,
    resetSession,
    tokenUsage,
    openModal,
    pendingAttachments,
    setPendingAttachments,
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    planMode,
    approvePlan,
    cancelPlan,
    startCraftPlanning,
    cancelCraftPlanning,
    exitApp,
  } = props;

  const handleCommand = useCallback(async (input: string): Promise<CommandResult> => {
    if (!input.startsWith('/')) {
      return { handled: false };
    }

    const resolvedInput = resolveCommand(input);
    const parts = resolvedInput.toLowerCase().trim().split(/\s+/);
    const command = parts[0] ?? '';

    switch (command) {
      // ============================================
      // App Control Commands
      // ============================================
      case '/exit':
      case '/quit':
      case '/q':
        exitApp();
        return { handled: true };

      case '/logout':
        openModal('logoutConfirm');
        return { handled: true };

      case '/clear':
        // Clear messages in current session (preserves session ID)
        // resetSession() handles clearing storage, updating state, and triggering remount
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        resetSession();
        return { handled: true };

      case '/new':
        // Create a new session - triggers component remount via key={session.id}
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        startNewSession();
        return { handled: true };

      // ============================================
      // File & Clipboard Commands
      // ============================================
      case '/paste':
      case '/image': {
        const clipboardItems = readClipboard();
        if (clipboardItems.length > 0) {
          setPendingAttachments(prev => [...prev, ...clipboardItems]);
          return { handled: true };
        }
        return {
          handled: true,
          message: {
            content: 'No files or images in clipboard. Copy a file (Cmd+C) or take a screenshot first.',
            type: 'error',
          },
        };
      }

      // ============================================
      // Help & Info Commands
      // ============================================
      case '/help':
      case '/?':
        openModal('help');
        return { handled: true };

      case '/resume':
        openModal('sessionMenu');
        return { handled: true };

      case '/tools': {
        const verbose = parts[1] === '-v' || parts[1] === '--verbose';
        const toolGroups = await fetchTools();
        if (toolGroups.length === 0) {
          return {
            handled: true,
            message: {
              content: 'No tools available. MCP connection may not be established.',
              type: 'error',
            },
          };
        }
        let toolsHelp = '**Available Tools**\n';
        for (const group of toolGroups) {
          toolsHelp += `\n**${group.name}**\n`;
          if (verbose) {
            for (const tool of group.tools) {
              toolsHelp += `  - ${tool.name}`;
              if (tool.description) {
                toolsHelp += `: ${tool.description}`;
              }
              toolsHelp += '\n';
            }
          } else {
            toolsHelp += `  ${group.tools.map(t => t.name).join(', ')}\n`;
          }
        }
        return {
          handled: true,
          message: { content: toolsHelp.trim(), type: 'assistant' },
        };
      }

      case '/prefs':
      case '/preferences':
        return {
          handled: true,
          message: { content: formatPreferencesDisplay(), type: 'assistant' },
        };

      case '/debug': {
        const sessionPath = `${homedir()}/.craft-agent/sessions/${session.id}.json`;
        let transcriptPath: string | null = null;
        if (session.sdkSessionId) {
          const projectSlug = process.cwd().replace(/\//g, '-');
          transcriptPath = `${homedir()}/.claude/projects/${projectSlug}/${session.sdkSessionId}.jsonl`;
        }

        let debugInfo = `**Debug Info**\n\n`;
        debugInfo += `Workspace: ${workspace.name}\n`;
        debugInfo += `Session ID: ${session.id}\n`;
        debugInfo += `SDK Session: ${session.sdkSessionId || 'none'}\n\n`;
        debugInfo += `Version: ${getCurrentVersion()}\n\n`;
        debugInfo += `**Files:**\n\n`;
        debugInfo += `file://${sessionPath}\n`;
        if (transcriptPath) {
          debugInfo += `file://${transcriptPath}\n`;
        }
        return {
          handled: true,
          message: { content: debugInfo, type: 'assistant' },
        };
      }

      case '/feedback': {
        if (!session.sdkSessionId) {
          return {
            handled: true,
            message: {
              content: 'No session transcript available. Start a conversation first.',
              type: 'error',
            },
          };
        }

        const projectSlug = process.cwd().replace(/\//g, '-');
        const transcriptFolder = `${homedir()}/.claude/projects/${projectSlug}`;
        const transcriptPath = `${transcriptFolder}/${session.sdkSessionId}.jsonl`;

        const { existsSync } = await import('fs');
        if (!existsSync(transcriptPath)) {
          return {
            handled: true,
            message: {
              content: `Transcript file not found: ${transcriptPath}`,
              type: 'error',
            },
          };
        }

        const { execSync } = await import('child_process');
        const platform = process.platform;
        const subject = 'Craft Agent Feedback';
        const recipient = 'beta@craft.do';
        const body = `\nPlease attach the transcript file from the folder that just opened.\nFilename: ${session.sdkSessionId}.jsonl`;

        try {
          if (platform === 'darwin') {
            execSync(`open "${transcriptFolder}"`, { stdio: 'ignore' });
          } else if (platform === 'linux') {
            execSync(`xdg-open "${transcriptFolder}"`, { stdio: 'ignore' });
          } else if (platform === 'win32') {
            execSync(`explorer "${transcriptFolder.replace(/\//g, '\\')}"`, { stdio: 'ignore' });
          }
        } catch {
          // fail silently
        }

        const mailtoUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        try {
          if (platform === 'darwin') {
            execSync(`open "${mailtoUrl}"`, { stdio: 'ignore' });
          } else if (platform === 'linux') {
            execSync(`xdg-open "${mailtoUrl}"`, { stdio: 'ignore' });
          } else if (platform === 'win32') {
            execSync(`start "" "${mailtoUrl}"`, { stdio: 'ignore' });
          }
          const fileLink = `\x1b]8;;file://${transcriptPath}\x07\x1b[4m${session.sdkSessionId}.jsonl\x1b[24m\x1b]8;;\x07`;
          const emailLink = `\x1b]8;;mailto:${recipient}\x07\x1b[4m${recipient}\x1b[24m\x1b]8;;\x07`;
          return {
            handled: true,
            message: {
              content: `Opening email to ${emailLink} and transcript location...\n\nDrag the file to attach: ${fileLink}`,
              type: 'system',
            },
          };
        } catch {
          return {
            handled: true,
            message: {
              content: `Could not open email client. Please email ${recipient} and attach:\n${transcriptPath}`,
              type: 'error',
            },
          };
        }
      }

      // ============================================
      // Settings Commands
      // ============================================
      case '/apikey':
        openModal('apiKeyChange');
        return { handled: true };

      case '/settings':
        openModal('settings');
        return { handled: true };

      case '/credits':
        openModal('balance');
        return { handled: true };

      case '/context': {
        // Context window limits (all current models use 200k)
        const contextWindow = 200000;
        const autocompactBuffer = 45000; // ~22.5% reserved by SDK

        // Build transcript path (same as /debug command)
        let transcriptPath: string | undefined;
        if (session.sdkSessionId) {
          const projectSlug = process.cwd().replace(/\//g, '-');
          transcriptPath = `${homedir()}/.claude/projects/${projectSlug}/${session.sdkSessionId}.jsonl`;
        }

        const output = formatContextDisplay({
          model,
          contextWindow,
          autocompactBuffer,
          totalUsed: tokenUsage.contextTokens,
          transcriptPath,
        });

        return { handled: true, message: { content: output, type: 'system' } };
      }

      // ============================================
      // Model Commands
      // ============================================
      case '/model': {
        const modelArg = parts[1];

        if (modelArg) {
          const num = parseInt(modelArg, 10);
          if (num >= 1 && num <= MODELS.length) {
            const selected = MODELS[num - 1];
            if (selected) {
              setModel(selected.id);
            }
            return { handled: true };
          }

          const matchedModel = MODELS.find(m =>
            m.id.toLowerCase().includes(modelArg.toLowerCase()) ||
            m.name.toLowerCase().includes(modelArg.toLowerCase())
          );

          if (matchedModel) {
            setModel(matchedModel.id);
            return { handled: true };
          }
          return {
            handled: true,
            message: { content: `Unknown model: ${modelArg}`, type: 'error' },
          };
        }
        openModal('modelSelector');
        return { handled: true };
      }

      // ============================================
      // Workspace Commands
      // ============================================
      case '/w':
      case '/workspace': {
        const subCommand = parts[1];
        const workspaces = getWorkspaces();

        if (subCommand === 'add') {
          openModal('workspaceAdd');
          return { handled: true };
        }

        if (subCommand === 'rename') {
          openModal('workspaceRename');
          return { handled: true };
        }

        if (subCommand === 'remove') {
          const nameToRemove = parts.slice(2).join(' ');
          if (!nameToRemove) {
            return {
              handled: true,
              message: { content: 'Usage: /workspace remove <name>', type: 'error' },
            };
          }

          const workspaceToRemove = workspaces.find(w =>
            w.name.toLowerCase().includes(nameToRemove.toLowerCase())
          );

          if (!workspaceToRemove) {
            return {
              handled: true,
              message: { content: `Space not found: ${nameToRemove}`, type: 'error' },
            };
          }

          if (workspaces.length === 1) {
            return {
              handled: true,
              message: {
                content: 'Cannot remove the only space. Add another space first.',
                type: 'error',
              },
            };
          }

          const isActive = workspaceToRemove.id === workspace.id;
          const removed = await removeWorkspace(workspaceToRemove.id);

          if (removed) {
            if (isActive) {
              const remainingWorkspaces = getWorkspaces();
              if (remainingWorkspaces.length > 0 && remainingWorkspaces[0]) {
                setWorkspace(remainingWorkspaces[0]);
              }
            }
            return { handled: true };
          }
          return {
            handled: true,
            message: { content: 'Failed to remove space', type: 'error' },
          };
        }

        if (subCommand) {
          const num = parseInt(subCommand, 10);
          if (num >= 1 && num <= workspaces.length) {
            const selected = workspaces[num - 1];
            if (selected) {
              setWorkspace(selected);
            }
            return { handled: true };
          }

          const matchedWorkspace = workspaces.find(w =>
            w.name.toLowerCase().includes(subCommand.toLowerCase())
          );

          if (matchedWorkspace) {
            setWorkspace(matchedWorkspace);
            return { handled: true };
          }
          return {
            handled: true,
            message: { content: `Unknown workspace: ${subCommand}`, type: 'error' },
          };
        }

        openModal('workspaceSelector');
        return { handled: true };
      }

      // ============================================
      // Plan Commands
      // ============================================
      case '/plan': {
        const subCommand = parts[1] ?? '';

        if (subCommand === 'start') {
          if (planMode) {
            return {
              handled: true,
              message: { content: 'Already in plan mode. Use /plan cancel to exit first.', type: 'error' },
            };
          }
          // Start Craft Agents plan mode (blocks API calls, uses CraftAskUserQuestion)
          startCraftPlanning();
          return {
            handled: true,
            message: {
              content: PLAN_MODE_ENTER_MESSAGE,
              type: 'system',
            },
            sendToAgent: PLAN_MODE_ENTER_PROMPT,
          };
        }

        if (subCommand === 'plans' || subCommand === 'list') {
          // Open unified plan selector modal
          openModal('planSelector');
          return { handled: true };
        }

        if (subCommand === 'load') {
          const planArg = parts.slice(2).join(' ');
          if (!planArg) {
            // No argument - open the modal selector
            openModal('planSelector');
            return { handled: true };
          }

          const planFiles = listPlanFiles(session.id);
          if (planFiles.length === 0) {
            return {
              handled: true,
              message: { content: 'No plan files found.', type: 'error' },
            };
          }

          // Try to match by number first
          const num = parseInt(planArg, 10);
          let selectedPlan: { name: string; path: string } | undefined;

          if (!isNaN(num) && num >= 1 && num <= planFiles.length) {
            selectedPlan = planFiles[num - 1];
          } else {
            // Match by name (partial, case-insensitive)
            selectedPlan = planFiles.find(f =>
              f.name.toLowerCase().includes(planArg.toLowerCase())
            );
          }

          if (!selectedPlan) {
            return {
              handled: true,
              message: { content: `Plan not found: ${planArg}`, type: 'error' },
            };
          }

          // Load the plan file as attachment
          const attachment = readFileAttachment(selectedPlan.path);
          if (!attachment) {
            return {
              handled: true,
              message: { content: `Failed to read plan file: ${selectedPlan.path}`, type: 'error' },
            };
          }

          setPendingAttachments(prev => [...prev, attachment]);
          return {
            handled: true,
            message: {
              content: `Plan "${selectedPlan.name}" loaded as attachment. Send a message to include it in context.`,
              type: 'system',
            },
          };
        }

        if (subCommand === 'view') {
          openModal('planReview');
          return { handled: true };
        }

        if (subCommand === 'cancel') {
          if (!planMode) {
            return {
              handled: true,
              message: { content: 'No active plan to cancel.', type: 'error' },
            };
          }
          cancelCraftPlanning();
          return {
            handled: true,
            message: { content: 'Plan cancelled. Returned to normal mode.', type: 'system' },
          };
        }

        if (subCommand === 'save') {
          return {
            handled: true,
            message: { content: 'Use the plan review modal to save plans to Craft.', type: 'system' },
          };
        }

        // No subcommand - open interactive plan menu
        openModal('planMenu');
        return { handled: true };
      }

      // ============================================
      // Agent Commands
      // ============================================
      case '/agent': {
        const subCommand = parts[1] ?? '';

        if (subCommand === 'list') {
          const agentList = availableAgents.length > 0
            ? availableAgents.map(a => `- @${a}`).join('\n')
            : '(No agents found. Create an "Agents" folder in Craft.)';
          return {
            handled: true,
            message: { content: `**Available Sub-Agents**\n\n${agentList}`, type: 'assistant' },
          };
        }

        if (subCommand === 'clear' || subCommand === 'dismiss') {
          deactivateAgent();
          return {
            handled: true,
            message: { content: 'Returned to main assistant', type: 'system' },
          };
        }

        if (subCommand === 'refresh') {
          const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
          setTerminalProgressIndeterminate();
          try {
            const result = await refreshAgents();
            if ('error' in result) {
              return {
                handled: true,
                message: { content: result.error, type: 'error' },
              };
            }
            const agentList = result.length > 0
              ? `Found ${result.length} agent${result.length === 1 ? '' : 's'}: ${result.map(a => `@${a}`).join(', ')}`
              : 'No agents found. Create an "Agents" folder in Craft with agent documents.';
            return {
              handled: true,
              message: { content: agentList, type: 'system' },
            };
          } finally {
            clearTerminalProgress();
          }
        }

        if (subCommand === 'info') {
          if (activeAgentName) {
            let info = `**Active Agent**: @${activeAgentName}`;

            if (activeAgentDefinition?.capabilities && activeAgentDefinition.capabilities.length > 0) {
              info += '\n\n**Capabilities**\n' + activeAgentDefinition.capabilities.map(c => `• ${c}`).join('\n');
            }

            const toolGroups = await fetchTools();
            const agentToolGroups = toolGroups.filter(g => g.name !== 'Craft');
            for (const group of agentToolGroups) {
              info += `\n\n**${group.name}**`;
              if (group.tools.length > 0) {
                info += `: ${group.tools.map(t => t.name).join(', ')}`;
              } else {
                info += ': (no tools)';
              }
            }
            return {
              handled: true,
              message: { content: info, type: 'assistant' },
            };
          }
          return {
            handled: true,
            message: { content: 'No sub-agent active. Use @agentname to activate one.', type: 'system' },
          };
        }

        if (subCommand === 'reload') {
          if (!activeAgentName) {
            return {
              handled: true,
              message: {
                content: 'No sub-agent active. Use @agentname to activate one first.',
                type: 'error',
              },
            };
          }
          const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
          setTerminalProgressIndeterminate();
          try {
            const success = await reloadAgent();
            if (success) {
              return {
                handled: true,
                message: { content: `Agent @${activeAgentName} instructions reloaded.`, type: 'system' },
              };
            }
            return {
              handled: true,
              message: { content: `Failed to reload agent @${activeAgentName}`, type: 'error' },
            };
          } finally {
            clearTerminalProgress();
          }
        }

        if (subCommand === 'reset') {
          if (!activeAgentName) {
            return {
              handled: true,
              message: {
                content: 'No sub-agent active. Use @agentname to activate one first.',
                type: 'error',
              },
            };
          }
          const agentToReset = activeAgentName;
          const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('../../utils/terminalProgress.ts');
          setTerminalProgressIndeterminate();
          try {
            const success = await resetAgent();
            if (success) {
              return {
                handled: true,
                message: {
                  content: `Agent @${agentToReset} reset. Select it again to restart setup.`,
                  type: 'system',
                },
              };
            }
            return {
              handled: true,
              message: { content: `Failed to reset agent @${agentToReset}`, type: 'error' },
            };
          } finally {
            clearTerminalProgress();
          }
        }

        if (subCommand === 'create') {
          return {
            handled: true,
            message: {
              content: 'Agent creation not yet implemented. Create a document in your "Agents" folder manually.',
              type: 'system',
            },
          };
        }

        if (subCommand) {
          const activated = await activateAgent(subCommand);
          if (!activated) {
            return {
              handled: true,
              message: { content: `Agent not found: ${subCommand}`, type: 'error' },
            };
          }
          return { handled: true };
        }

        openModal('agentMenu');
        return { handled: true };
      }

      // ============================================
      // Unknown Command
      // ============================================
      default:
        return {
          handled: true,
          message: {
            content: `Unknown command: ${command}. Type /help for available commands.`,
            type: 'error',
          },
        };
    }
  }, [
    workspace,
    session,
    model,
    setModel,
    setWorkspace,
    startNewSession,
    resetSession,
    tokenUsage,
    openModal,
    pendingAttachments,
    setPendingAttachments,
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    planMode,
    approvePlan,
    cancelPlan,
    startCraftPlanning,
    cancelCraftPlanning,
    exitApp,
  ]);

  return { handleCommand };
}
