import { useCallback } from 'react';
import { homedir } from 'os';
import { basename, resolve } from 'path';
import { MODELS, getWorkspaces, removeWorkspace, addWorkspace, setActiveWorkspace, type Workspace } from '@craft-agent/shared/config';
import { formatPreferencesDisplay } from '@craft-agent/shared/config';
import { listPlanFiles, type SessionConfig } from '@craft-agent/shared/sessions';
import { resolveCommand } from '../../utils/filtering.ts';
import { readClipboard, readFileAttachment, type FileAttachment } from '@craft-agent/shared/utils';
import { getCurrentVersion } from '@craft-agent/shared/version';
import type { ModalName } from '../modals/useModalState.ts';
import type { Message } from '../../components/Messages.tsx';
import { PERMISSION_MODE_MESSAGES, PERMISSION_MODE_PROMPTS } from '@craft-agent/shared/agent';
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
  session: SessionConfig;
  model: string;
  setModel: (model: string) => void;
  setWorkspace: (workspace: Workspace) => void;
  startNewSession: () => SessionConfig;
  resetSession: () => void;
  tokenUsage: { contextTokens: number };

  // Modal control
  openModal: (name: ModalName) => void;

  // Attachment handling
  pendingAttachments: FileAttachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<FileAttachment[]>>;

  // Agent operations (stubs - agent system removed)
  availableAgents: string[];
  activeAgentName: string | null;
  activeAgentDefinition: unknown | null;
  activateAgent: (name: string) => Promise<boolean>;
  deactivateAgent: () => void;
  reloadAgent: () => Promise<void>;
  resetAgent: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  fetchTools: () => Promise<ToolGroup[]>;

  // Safe mode operations (read-only exploration)
  safeMode: boolean;
  approvePlan: () => void;
  cancelPlan: () => void;
  // Permission mode control
  setSessionPermissionMode: (mode: import('@craft-agent/shared/agent').PermissionMode) => void;

  // Exit handler
  exitApp: () => void;

  // Safe mode
  setSafeModeSetting: (enabled: boolean) => void;
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
    safeMode,
    approvePlan,
    cancelPlan,
    setSessionPermissionMode,
    exitApp,
    setSafeModeSetting,
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

      case '/safemode': {
        const newMode = !safeMode;
        setSafeModeSetting(newMode);
        return {
          handled: true,
          message: {
            content: `Safe Mode ${newMode ? 'enabled' : 'disabled'}. ${newMode ? 'Delete/update/move operations will require approval.' : 'All operations will execute without prompts.'}`,
            type: 'info',
          },
        };
      }

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

        if (subCommand === 'rename') {
          openModal('workspaceRename');
          return { handled: true };
        }

        if (subCommand === 'add' || subCommand === 'new' || subCommand === 'create') {
          // Get folder path from args, or use current directory
          const folderPathArg = parts.slice(2).join(' ');
          const folderPath = folderPathArg ? resolve(folderPathArg) : process.cwd();
          const name = basename(folderPath);

          try {
            // Create workspace at {folderPath}/.craft-agent/
            const rootPath = `${folderPath}/.craft-agent`;
            const newWorkspace = addWorkspace({ name, rootPath });
            setActiveWorkspace(newWorkspace.id);
            setWorkspace(newWorkspace);

            return {
              handled: true,
              message: {
                content: `Created workspace "${name}" at ${rootPath}`,
                type: 'system',
              },
            };
          } catch (error) {
            return {
              handled: true,
              message: {
                content: `Failed to create workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
                type: 'error',
              },
            };
          }
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
      // Safe Mode Commands
      // ============================================
      case '/safe': {
        const subCommand = parts[1] ?? '';

        if (subCommand === '' || subCommand === 'start') {
          if (safeMode) {
            return {
              handled: true,
              message: { content: 'Already in safe mode. Use /safe cancel to exit first.', type: 'error' },
            };
          }
          // Start Safe Mode (blocks writes during exploration)
          setSessionPermissionMode('safe');
          return {
            handled: true,
            message: {
              content: PERMISSION_MODE_MESSAGES['safe'],
              type: 'system',
            },
            sendToAgent: PERMISSION_MODE_PROMPTS['safe'],
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

          const planFiles = listPlanFiles(session.workspaceRootPath, session.id);
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
          // Check if there's a plan loaded as attachment
          const planAttachment = pendingAttachments.find(a => a.name.endsWith('.md'));
          if (!planAttachment) {
            return {
              handled: true,
              message: { content: 'No plan loaded. Use `/plan load <name>` to load one.', type: 'system' },
            };
          }
          return {
            handled: true,
            message: { content: `**Plan: ${planAttachment.name}**\n\n${planAttachment.text || '(No content)'}`, type: 'assistant' },
          };
        }

        if (subCommand === 'approve') {
          if (!safeMode) {
            return {
              handled: true,
              message: { content: 'No active safe mode. Plan approval happens after SubmitPlan is called.', type: 'system' },
            };
          }
          approvePlan();
          return {
            handled: true,
            message: { content: 'Plan approved. Execution starting...', type: 'system' },
          };
        }

        if (subCommand === 'cancel') {
          if (!safeMode) {
            return {
              handled: true,
              message: { content: 'No active safe mode to cancel.', type: 'error' },
            };
          }
          setSessionPermissionMode('ask');
          return {
            handled: true,
            message: { content: 'Safe mode cancelled. Returned to normal mode.', type: 'system' },
          };
        }

        if (subCommand === 'save') {
          return {
            handled: true,
            message: { content: 'Plan saving is not available in TUI.', type: 'system' },
          };
        }

        // No subcommand - show help
        return {
          handled: true,
          message: {
            content: `**Plan Commands**\n\n- \`/plan list\` - List available plans\n- \`/plan load <name>\` - Load a plan\n- \`/plan view\` - View active plan\n- \`/plan approve\` - Approve plan (in safe mode)\n- \`/plan cancel\` - Cancel safe mode`,
            type: 'assistant',
          },
        };
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
          return {
            handled: true,
            message: { content: 'Agent commands not available in TUI. Use /sources to view data sources.', type: 'info' },
          };
        }

        if (subCommand === 'info') {
          return {
            handled: true,
            message: { content: 'Agent commands not available in TUI. Use /sources to view data sources.', type: 'info' },
          };
        }

        if (subCommand === 'reload') {
          return {
            handled: true,
            message: { content: 'Agent commands not available in TUI.', type: 'info' },
          };
        }

        if (subCommand === 'reset') {
          return {
            handled: true,
            message: { content: 'Agent commands not available in TUI.', type: 'info' },
          };
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

        // No subcommand - list available agents
        const agentList = availableAgents.length > 0
          ? availableAgents.map(a => `- @${a}`).join('\n')
          : '(No agents found)';
        return {
          handled: true,
          message: { content: `**Available Agents**\n\n${agentList}\n\nUse \`/agent <name>\` to activate.`, type: 'assistant' },
        };
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
    safeMode,
    approvePlan,
    cancelPlan,
    setSessionPermissionMode,
    exitApp,
    setSafeModeSetting,
  ]);

  return { handleCommand };
}
