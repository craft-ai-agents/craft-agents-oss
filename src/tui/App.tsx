import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { homedir } from 'os';
import { Box, useApp, useInput, Text } from 'ink';
import { Header } from './components/Header.tsx';
import { Messages, type Message } from './components/Messages.tsx';
import { Input, InputHint } from './components/Input.tsx';
import { ModelSelector, type Model } from './components/ModelSelector.tsx';
import { AgentMenu, type AgentAction } from './components/AgentMenu.tsx';
import { WorkspaceSelector } from './components/WorkspaceSelector.tsx';
import { WorkspaceAdd } from './components/WorkspaceAdd.tsx';
import { WorkspaceRename } from './components/WorkspaceRename.tsx';
import { ApiKeyChange } from './components/ApiKeyChange.tsx';
import { AskUserQuestion } from './components/AskUserQuestion.tsx';
import { McpAuth } from './components/McpAuth.tsx';
import { ApiAuth } from './components/ApiAuth.tsx';
import { AgentReview } from './components/AgentReview.tsx';
import { HelpPanel } from './components/HelpPanel.tsx';
import { Balance } from './components/Balance.tsx';
import { useAgent } from './hooks/useAgent.ts';
import { useHistory } from './hooks/useHistory.ts';
import { useResize } from './hooks/useResize.ts';
import { getConfigPath, getWorkspaces, setActiveWorkspace, removeWorkspace, renameWorkspace, getWorkspaceDataPath, updateApiKey, getAuthType, type Workspace, type AuthType } from '../config/storage.ts';
import { formatPreferencesDisplay, getPreferencesPath } from '../config/preferences.ts';
import { formatTokens } from './utils/markdown.ts';
import { processInputWithFiles, readClipboard, type FileAttachment } from './utils/files.ts';
import { resolveCommand, resolveAgentMention } from './utils/filtering.ts';
import { debug, isDebugEnabled } from './utils/debug.ts';
import type { CraftAgentConfig } from '../agent/craft-agent.ts';
import { getCurrentVersion } from '../version/version.ts';

export interface AppProps {
  config: CraftAgentConfig;
  onRequestSetup?: () => void;
  /** Agent to auto-activate on startup (without @ prefix) */
  initialAgent?: string;
  /** Prompt to auto-send after agent activation (or immediately if no agent) */
  initialPrompt?: string;
  /** Error message to display on startup (e.g., workspace not found) */
  initialError?: string;
}

export const App: React.FC<AppProps> = ({ config, onRequestSetup, initialAgent, initialPrompt, initialError }) => {
  const { exit } = useApp();

  const {
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
    tokenUsage,
    pendingPermission,
    pendingQuestion,
    hasExecutingTool,
    sendMessage,
    clearMessages,
    interrupt,
    respondToPermission,
    respondToQuestion,
    model,
    setModel,
    workspace,
    setWorkspace,
    isWebSearchEnabled,
    setWebSearchEnabled,
    isWebFetchEnabled,
    setWebFetchEnabled,
    isCodeExecutionEnabled,
    setCodeExecutionEnabled,
    // Agent-related
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    agentsLoading,
    // MCP auth for sub-agent servers
    pendingMcpAuth,
    completeMcpAuth,
    cancelMcpAuth,
    triggerMcpAuth,
    // API auth for REST API integrations
    pendingApiAuth,
    completeApiAuth,
    cancelApiAuth,
    // Review mode (concerns from extraction)
    pendingReview,
    completeReview,
    skipReview,
  } = useAgent(config);

  const { history, addToHistory } = useHistory();
  const [localMessages, setLocalMessages] = useState<Message[]>(() => {
    // Initialize with error message if provided (e.g., workspace not found)
    if (initialError) {
      return [{
        id: `startup-error-${Date.now()}`,
        type: 'error',
        content: initialError,
        timestamp: Date.now(),
      }];
    }
    return [];
  });
  const [compactMode, setCompactMode] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [staticResetKey, setStaticResetKey] = useState(0); // Incremented on /clear to create fresh Static items
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const [showWorkspaceAdd, setShowWorkspaceAdd] = useState(false);
  const [showWorkspaceRename, setShowWorkspaceRename] = useState(false);
  const [showApiKeyChange, setShowApiKeyChange] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [pendingRemoveWorkspace, setPendingRemoveWorkspace] = useState<string | null>(null);

  // Track if we've processed initial startup params
  const initialStartupDoneRef = useRef(false);
  const initialPromptPendingRef = useRef<string | null>(initialPrompt ?? null);

  // Track if agent loading has started (agentsLoading became true at least once)
  const agentsLoadingStartedRef = useRef(false);
  if (agentsLoading) {
    agentsLoadingStartedRef.current = true;
  }

  // Handle initial agent activation and prompt on startup
  useEffect(() => {
    // Only run once
    if (initialStartupDoneRef.current) return;

    // If we need an agent, wait for discovery to complete
    if (initialAgent) {
      // Loading hasn't even started yet - wait
      if (!agentsLoadingStartedRef.current) return;
      // Still loading - wait
      if (agentsLoading) return;
    }

    const runInitialStartup = async () => {
      initialStartupDoneRef.current = true;

      // If initial agent specified, activate it first
      if (initialAgent) {
        debug('[App] Auto-activating initial agent:', initialAgent);

        // Check if agent exists
        const agentExists = availableAgents.some(
          a => a.toLowerCase() === initialAgent.toLowerCase()
        );

        if (!agentExists) {
          setLocalMessages(prev => [...prev, {
            id: `startup-error-${Date.now()}`,
            type: 'error',
            content: `Agent '@${initialAgent}' not found. Available agents: ${availableAgents.map(a => `@${a}`).join(', ') || 'none'}`,
            timestamp: Date.now(),
          }]);
          // Cancel initial prompt - don't send to main agent since user intended specific agent
          initialPromptPendingRef.current = null;
          return;
        }

        const result = await activateAgent(initialAgent);
        debug('[App] Initial agent activation result:', result);

        if (result === 'pending_auth') {
          // Auth flow will handle it - prompt will be sent after auth completes
          // We'll handle this in the auth completion callbacks
          return;
        }

        if (result !== true) {
          setLocalMessages(prev => [...prev, {
            id: `startup-error-${Date.now()}`,
            type: 'error',
            content: `Failed to activate agent '@${initialAgent}'`,
            timestamp: Date.now(),
          }]);
        }
      }

      // Send initial prompt if specified (and no auth pending)
      if (initialPromptPendingRef.current) {
        debug('[App] Auto-sending initial prompt');
        await sendMessage(initialPromptPendingRef.current);
        initialPromptPendingRef.current = null;
      }
    };

    runInitialStartup();
  }, [agentsLoading, availableAgents, initialAgent, activateAgent, sendMessage]);

  // Handle initial prompt after auth completes (for agents that needed auth)
  useEffect(() => {
    // If we have a pending prompt and auth just completed (no more pending auth)
    if (
      initialPromptPendingRef.current &&
      !pendingMcpAuth &&
      !pendingApiAuth &&
      !pendingReview &&
      activeAgentName // Agent is now active
    ) {
      debug('[App] Auth completed, sending pending initial prompt');
      const prompt = initialPromptPendingRef.current;
      initialPromptPendingRef.current = null;
      sendMessage(prompt);
    }
  }, [pendingMcpAuth, pendingApiAuth, pendingReview, activeAgentName, sendMessage]);

  // Handle terminal resize - clears screen (debounced) and increments staticResetKey
  // Both state updates batch together so Static items re-render on clean screen
  const handleTerminalResize = useCallback(() => {
    setStaticResetKey(k => k + 1);
  }, []);
  const { columns: terminalColumns } = useResize(handleTerminalResize);

  // Models list
  const models: Model[] = [
    { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', desc: 'Most capable' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', desc: 'Balanced' },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Fast & efficient' },
  ];

  const addLocalMessage = useCallback((content: string, type: Message['type'] = 'system') => {
    setLocalMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, type, content, timestamp: Date.now() },
    ]);
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setShowModelSelector(false);
    setModel(modelId);
  }, [setModel]);

  const handleModelCancel = useCallback(() => {
    setShowModelSelector(false);
  }, []);

  // Agent menu handler
  const handleAgentAction = useCallback(async (action: AgentAction) => {
    setShowAgentMenu(false);

    switch (action.type) {
      case 'activate': {
        const result = await activateAgent(action.name);
        if (result === true) {
          // Message shown by activationComplete() in useAgent
        } else if (result === 'pending_auth') {
          // Auth flow started - will complete via McpAuth/ApiAuth components
        } else {
          addLocalMessage(`Failed to activate agent: ${action.name}`, 'error');
        }
        break;
      }
      case 'clear':
        deactivateAgent();
        addLocalMessage('Returned to main assistant', 'system');
        break;
      case 'reload': {
        if (!activeAgentName) return;
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
        setTerminalProgressIndeterminate();
        try {
          const success = await reloadAgent();
          if (success) {
            addLocalMessage(`Agent @${activeAgentName} instructions reloaded.`, 'system');
          } else {
            addLocalMessage(`Failed to reload agent @${activeAgentName}`, 'error');
          }
        } finally {
          clearTerminalProgress();
        }
        break;
      }
      case 'reset': {
        if (!activeAgentName) return;
        const agentToReset = activeAgentName;
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
        addLocalMessage(`Fully resetting @${agentToReset}...`, 'system');
        setTerminalProgressIndeterminate();
        try {
          const success = await resetAgent();
          if (success) {
            addLocalMessage(`Agent @${agentToReset} reset. Select it again to restart setup.`, 'system');
          } else {
            addLocalMessage(`Failed to reset agent @${agentToReset}`, 'error');
          }
        } finally {
          clearTerminalProgress();
        }
        break;
      }
      case 'refresh': {
        const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
        setTerminalProgressIndeterminate();
        try {
          const result = await refreshAgents();
          if ('error' in result) {
            addLocalMessage(result.error, 'error');
          } else {
            const agentList = result.length > 0
              ? `Found ${result.length} agent${result.length === 1 ? '' : 's'}: ${result.map(a => `@${a}`).join(', ')}`
              : 'No agents found. Create an "Agents" folder in Craft with agent documents.';
            addLocalMessage(agentList, 'system');
          }
        } finally {
          clearTerminalProgress();
        }
        break;
      }
      case 'info': {
        debug('[handleAgentAction.info] activeAgentName:', activeAgentName, 'mcpServers:', activeAgentMcpServers.length);
        if (activeAgentName && activeAgentDefinition) {
          let info = `**Active Agent**: @${activeAgentName}`;

          // Show info messages if any
          if (activeAgentDefinition.info && activeAgentDefinition.info.length > 0) {
            info += '\n\n**Info**';
            for (const msg of activeAgentDefinition.info) {
              info += `\nℹ ${msg}`;
            }
          }

          // Fetch tools and show agent-specific ones (exclude Craft)
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

          debug('[handleAgentAction.info] Adding message:', info);
          addLocalMessage(info, 'assistant');
        } else {
          addLocalMessage('No sub-agent active. Use @agentname to activate one.', 'system');
        }
        break;
      }
    }
  }, [activateAgent, deactivateAgent, reloadAgent, resetAgent, refreshAgents, fetchTools, activeAgentName, activeAgentDefinition, activeAgentMcpServers, addLocalMessage]);

  const handleAgentMenuCancel = useCallback(() => {
    setShowAgentMenu(false);
  }, []);

  // Workspace handlers
  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    setShowWorkspaceSelector(false);
    const workspaces = getWorkspaces();
    const selectedWorkspace = workspaces.find(w => w.id === workspaceId);
    if (selectedWorkspace) {
      setActiveWorkspace(workspaceId);
      setWorkspace(selectedWorkspace);
    }
  }, [setWorkspace]);

  const handleWorkspaceCancel = useCallback(() => {
    setShowWorkspaceSelector(false);
  }, []);

  const handleWorkspaceAddOpen = useCallback(() => {
    setShowWorkspaceSelector(false);
    setShowWorkspaceAdd(true);
  }, []);

  const handleWorkspaceRenameOpen = useCallback((workspaceId: string) => {
    setShowWorkspaceSelector(false);
    // If renaming a different workspace, switch to it first
    if (workspaceId !== workspace.id) {
      const workspaces = getWorkspaces();
      const targetWorkspace = workspaces.find(w => w.id === workspaceId);
      if (targetWorkspace) {
        setActiveWorkspace(workspaceId);
        setWorkspace(targetWorkspace);
      }
    }
    setShowWorkspaceRename(true);
  }, [workspace.id, setWorkspace]);

  const handleWorkspaceRemove = useCallback(async (workspaceId: string) => {
    setShowWorkspaceSelector(false);
    const workspaces = getWorkspaces();

    if (workspaces.length === 1) {
      addLocalMessage('Cannot remove the only workspace. Add another workspace first.', 'error');
      return;
    }

    const workspaceToRemove = workspaces.find(w => w.id === workspaceId);
    if (!workspaceToRemove) {
      addLocalMessage('Workspace not found.', 'error');
      return;
    }

    const isActive = workspaceId === workspace.id;
    const removed = await removeWorkspace(workspaceId);

    if (removed) {
      addLocalMessage(`Workspace "${workspaceToRemove.name}" removed.`, 'system');
      // If we removed the active workspace, switch to another
      if (isActive) {
        const remainingWorkspaces = getWorkspaces();
        if (remainingWorkspaces.length > 0 && remainingWorkspaces[0]) {
          setActiveWorkspace(remainingWorkspaces[0].id);
          setWorkspace(remainingWorkspaces[0]);
        }
      }
    } else {
      addLocalMessage('Failed to remove workspace.', 'error');
    }
  }, [workspace.id, setWorkspace, addLocalMessage]);

  const handleWorkspaceAddComplete = useCallback((newWorkspace: Workspace) => {
    setShowWorkspaceAdd(false);
    setActiveWorkspace(newWorkspace.id);
    setWorkspace(newWorkspace);
  }, [setWorkspace]);

  const handleWorkspaceAddCancel = useCallback(() => {
    setShowWorkspaceAdd(false);
  }, []);

  const handleWorkspaceRenameSubmit = useCallback((newName: string) => {
    setShowWorkspaceRename(false);
    const success = renameWorkspace(workspace.id, newName);
    if (success) {
      // Update local workspace state with new name
      setWorkspace({ ...workspace, name: newName });
    }
  }, [workspace, setWorkspace]);

  const handleWorkspaceRenameCancel = useCallback(() => {
    setShowWorkspaceRename(false);
  }, []);

  const handleApiKeySubmit = useCallback(async (newApiKey: string) => {
    setShowApiKeyChange(false);
    try {
      const success = await updateApiKey(newApiKey);
      if (success) {
        addLocalMessage('API key updated. Restart the app to use the new key.', 'system');
      } else {
        addLocalMessage('Failed to update API key.', 'error');
      }
    } catch {
      addLocalMessage('Failed to update API key.', 'error');
    }
  }, [addLocalMessage]);

  const handleApiKeyCancel = useCallback(() => {
    setShowApiKeyChange(false);
  }, []);

  const handlePaste = useCallback(() => {
    try {
      const clipboardItems = readClipboard();

      if (clipboardItems.length > 0) {
        setPendingAttachments(prev => [...prev, ...clipboardItems]);
      } else {
        addLocalMessage('No files or images in clipboard. Copy a file (Cmd+C) or take a screenshot first.', 'error');
      }
    } catch (err) {
      addLocalMessage(`Clipboard error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [addLocalMessage]);

  // Remove last attachment when backspace pressed with empty input
  const handleRemoveAttachment = useCallback(() => {
    setPendingAttachments(prev => {
      if (prev.length > 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  // Clear all attachments (Escape key)
  const handleClearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  // Handle pasted text (e.g., dragged file paths from terminal)
  const handlePastedText = useCallback((text: string) => {
    // Check if the pasted text contains file paths
    const { attachments, errors } = processInputWithFiles(text);

    if (attachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...attachments]);
    }

    for (const error of errors) {
      addLocalMessage(error, 'error');
    }
  }, [addLocalMessage]);

  // Generate attachment label for display
  const attachmentLabel = useMemo(() => {
    if (pendingAttachments.length === 0) return '';
    if (pendingAttachments.length === 1) {
      const att = pendingAttachments[0];
      if (!att) return '1 file';
      const icon = att.type === 'image' ? '🖼' : att.type === 'pdf' ? '📄' : '📝';
      return `${icon} ${att.name}`;
    }
    const imageCount = pendingAttachments.filter(a => a.type === 'image').length;
    const fileCount = pendingAttachments.length - imageCount;
    const parts: string[] = [];
    if (imageCount > 0) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
    if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
    return parts.join(', ');
  }, [pendingAttachments]);

  const handleSubmit = useCallback(
    async (input: string) => {
      // Add ALL inputs to history for arrow key recall (persisted to file)
      addToHistory(input);

      // Handle @mentions
      if (input.startsWith('@')) {
        const [mentionInput, ...rest] = input.slice(1).split(/\s+/);

        debug('[App.handleSubmit] @mention input:', mentionInput);
        debug('[App.handleSubmit] availableAgents:', availableAgents);

        // Just "@" with nothing after - open agent menu
        if (!mentionInput) {
          setShowAgentMenu(true);
          return;
        }

        // Resolve partial mention to full agent name
        const resolvedAgent = resolveAgentMention(mentionInput, availableAgents);
        debug('[App.handleSubmit] resolvedAgent:', resolvedAgent);

        if (resolvedAgent === 'main') {
          deactivateAgent();
          addLocalMessage('Returned to main assistant', 'system');
          return;
        }

        if (resolvedAgent === 'agent') {
          // Open the agent menu
          setShowAgentMenu(true);
          return;
        }

        if (resolvedAgent) {
          const activated = await activateAgent(resolvedAgent);
          if (activated) {
            // Message shown by activationComplete() in useAgent
            // If there's text after @agent, send it as a message
            const remainingText = rest.join(' ').trim();
            if (remainingText) {
              await sendMessage(remainingText);
            }
          } else {
            addLocalMessage(`Agent not found: @${resolvedAgent}`, 'error');
          }
          return;
        } else {
          addLocalMessage(`Agent not found: @${mentionInput}`, 'error');
          return;
        }
      }

      // Handle slash commands
      if (input.startsWith('/')) {
        // Resolve partial commands to full commands (e.g., "/he" -> "/help", "/w r" -> "/workspace rename")
        const resolvedInput = resolveCommand(input);
        const parts = resolvedInput.toLowerCase().trim().split(/\s+/);
        const command = parts[0] ?? '';

        switch (command) {
          case '/exit':
          case '/quit':
          case '/q':
            exit();
            return;

          case '/clear':
            // Clear screen FIRST (before state updates)
            // This ensures Static renders AFTER the screen is blank
            process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
            // Then update state - this triggers re-render with fresh Static content
            clearMessages();
            setLocalMessages([]);
            setPendingAttachments([]);
            setShowWelcome(true);
            setStaticResetKey(k => k + 1);
            return;

          case '/paste':
          case '/image': {
            const clipboardItems = readClipboard();
            if (clipboardItems.length > 0) {
              setPendingAttachments(prev => [...prev, ...clipboardItems]);
            } else {
              addLocalMessage('No files or images in clipboard. Copy a file (Cmd+C) or take a screenshot first.', 'error');
            }
            return;
          }

          case '/help':
          case '/?':
            setShowHelp(true);
            return;

          case '/tools': {
            const verbose = parts[1] === '-v' || parts[1] === '--verbose';
            const toolGroups = await fetchTools();
            if (toolGroups.length === 0) {
              addLocalMessage('No tools available. MCP connection may not be established.', 'error');
              return;
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
            addLocalMessage(toolsHelp.trim(), 'assistant');
            return;
          }

          case '/setup':
            if (onRequestSetup) {
              onRequestSetup();
            } else {
              addLocalMessage('Setup not available. Run with --setup flag to reconfigure.', 'system');
            }
            return;

          case '/apikey':
            setShowApiKeyChange(true);
            return;

          case '/config':
            const currentAuthType = getAuthType();
            addLocalMessage(
              `**Configuration**

- Config file: \`${getConfigPath()}\`
- Claude auth: ${currentAuthType === 'oauth_token' ? '**Max Subscription**' : 'API Key'}
- Workspace: \`${workspace.name}\`
- MCP URL: \`${workspace.mcpUrl}\`
- Model: \`${model}\`
- Compact mode: ${compactMode ? 'On' : 'Off'}
- Web search: ${isWebSearchEnabled() ? 'On' : 'Off'}
- Web fetch: ${isWebFetchEnabled() ? 'On' : 'Off'}
- Code execution: ${isCodeExecutionEnabled() ? 'On' : 'Off'}`,
              'assistant'
            );
            return;

          case '/prefs':
          case '/preferences':
            addLocalMessage(formatPreferencesDisplay(), 'assistant');
            return;

          case '/compact':
            setCompactMode(!compactMode);
            addLocalMessage(
              `Compact mode: ${!compactMode ? 'On' : 'Off'}`,
              'system'
            );
            return;

          case '/cost': {
            const costDisplay = tokenUsage.costUsd < 0.01
              ? `$${(tokenUsage.costUsd * 100).toFixed(2)}¢`
              : `$${tokenUsage.costUsd.toFixed(4)}`;

            // Calculate cache hit rate for debug mode
            const totalCacheTokens = tokenUsage.cacheReadTokens + tokenUsage.cacheCreationTokens;
            const cacheHitRate = totalCacheTokens > 0
              ? ((tokenUsage.cacheReadTokens / totalCacheTokens) * 100).toFixed(1)
              : '0.0';

            let costMessage = `**Token Usage (this session)**

- Input tokens: ${formatTokens(tokenUsage.inputTokens)}
- Output tokens: ${formatTokens(tokenUsage.outputTokens)}
- Total tokens: ${formatTokens(tokenUsage.totalTokens)}
- Cost: ${costDisplay}`;

            // Add cache stats only in debug mode
            if (isDebugEnabled()) {
              costMessage += `

**Cache Stats (debug)**
- Cache read tokens: ${formatTokens(tokenUsage.cacheReadTokens)}
- Cache creation tokens: ${formatTokens(tokenUsage.cacheCreationTokens)}
- Cache hit rate: ${cacheHitRate}%`;
            }

            addLocalMessage(costMessage, 'assistant');
            return;
          }

          case '/model': {
            const modelArg = parts[1];

            if (modelArg) {
              // Parse number selection
              const num = parseInt(modelArg, 10);
              if (num >= 1 && num <= models.length) {
                const selected = models[num - 1];
                if (selected) {
                  setModel(selected.id);
                }
                return;
              }

              // Find matching model (partial match)
              const matchedModel = models.find(m =>
                m.id.toLowerCase().includes(modelArg.toLowerCase()) ||
                m.name.toLowerCase().includes(modelArg.toLowerCase())
              );

              if (matchedModel) {
                setModel(matchedModel.id);
              } else {
                addLocalMessage(`Unknown model: ${modelArg}`, 'error');
              }
            } else {
              // Show interactive selector
              setShowModelSelector(true);
            }
            return;
          }

          case '/w':
          case '/workspace': {
            const subCommand = parts[1];
            const workspaces = getWorkspaces();

            if (subCommand === 'add') {
              setShowWorkspaceAdd(true);
              return;
            }

            if (subCommand === 'rename') {
              setShowWorkspaceRename(true);
              return;
            }

            if (subCommand === 'remove') {
              const nameToRemove = parts.slice(2).join(' ');
              if (!nameToRemove) {
                addLocalMessage('Usage: /workspace remove <name>', 'error');
                return;
              }

              const workspaceToRemove = workspaces.find(w =>
                w.name.toLowerCase().includes(nameToRemove.toLowerCase())
              );

              if (!workspaceToRemove) {
                addLocalMessage(`Workspace not found: ${nameToRemove}`, 'error');
                return;
              }

              if (workspaces.length === 1) {
                addLocalMessage('Cannot remove the only workspace. Add another workspace first.', 'error');
                return;
              }

              // Check if removing active workspace
              const isActive = workspaceToRemove.id === workspace.id;
              const removed = await removeWorkspace(workspaceToRemove.id);

              if (removed) {
                // If we removed the active workspace, switch to another
                if (isActive) {
                  const remainingWorkspaces = getWorkspaces();
                  if (remainingWorkspaces.length > 0 && remainingWorkspaces[0]) {
                    setActiveWorkspace(remainingWorkspaces[0].id);
                    setWorkspace(remainingWorkspaces[0]);
                  }
                }
              } else {
                addLocalMessage('Failed to remove workspace', 'error');
              }
              return;
            }

            if (subCommand) {
              // Parse number selection
              const num = parseInt(subCommand, 10);
              if (num >= 1 && num <= workspaces.length) {
                const selected = workspaces[num - 1];
                if (selected) {
                  setActiveWorkspace(selected.id);
                  setWorkspace(selected);
                }
                return;
              }

              // Find matching workspace (partial match)
              const matchedWorkspace = workspaces.find(w =>
                w.name.toLowerCase().includes(subCommand.toLowerCase())
              );

              if (matchedWorkspace) {
                setActiveWorkspace(matchedWorkspace.id);
                setWorkspace(matchedWorkspace);
              } else {
                addLocalMessage(`Unknown workspace: ${subCommand}`, 'error');
              }
            } else {
              // Show interactive selector
              setShowWorkspaceSelector(true);
            }
            return;
          }

          case '/agent': {
            // Subcommand already resolved by resolveCommand()
            const subCommand = parts[1] ?? '';

            if (subCommand === 'list') {
              // List available agents
              const agentList = availableAgents.length > 0
                ? availableAgents.map(a => `- @${a}`).join('\n')
                : '(No agents found. Create an "Agents" folder in Craft.)';
              addLocalMessage(`**Available Sub-Agents**\n\n${agentList}`, 'assistant');
              return;
            }

            if (subCommand === 'clear' || subCommand === 'dismiss') {
              deactivateAgent();
              addLocalMessage('Returned to main assistant', 'system');
              return;
            }

            if (subCommand === 'refresh') {
              const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
              setTerminalProgressIndeterminate();
              try {
                const result = await refreshAgents();
                if ('error' in result) {
                  addLocalMessage(result.error, 'error');
                } else {
                  const agentList = result.length > 0
                    ? `Found ${result.length} agent${result.length === 1 ? '' : 's'}: ${result.map(a => `@${a}`).join(', ')}`
                    : 'No agents found. Create an "Agents" folder in Craft with agent documents.';
                  addLocalMessage(agentList, 'system');
                }
              } finally {
                clearTerminalProgress();
              }
              return;
            }

            if (subCommand === 'info') {
              if (activeAgentName) {
                let info = `**Active Agent**: @${activeAgentName}`;

                // Show capabilities if available
                if (activeAgentDefinition?.capabilities && activeAgentDefinition.capabilities.length > 0) {
                  info += '\n\n**Capabilities**\n' + activeAgentDefinition.capabilities.map(c => `• ${c}`).join('\n');
                }

                // Fetch tools and show agent-specific ones (exclude Craft)
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
                addLocalMessage(info, 'assistant');
              } else {
                addLocalMessage('No sub-agent active. Use @agentname to activate one.', 'system');
              }
              return;
            }

            if (subCommand === 'reload') {
              if (!activeAgentName) {
                addLocalMessage('No sub-agent active. Use @agentname to activate one first.', 'error');
                return;
              }
              const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
              setTerminalProgressIndeterminate();
              try {
                const success = await reloadAgent();
                if (success) {
                  addLocalMessage(`Agent @${activeAgentName} instructions reloaded.`, 'system');
                } else {
                  addLocalMessage(`Failed to reload agent @${activeAgentName}`, 'error');
                }
              } finally {
                clearTerminalProgress();
              }
              return;
            }

            if (subCommand === 'reset') {
              if (!activeAgentName) {
                addLocalMessage('No sub-agent active. Use @agentname to activate one first.', 'error');
                return;
              }
              const agentToReset = activeAgentName;
              const { setTerminalProgressIndeterminate, clearTerminalProgress } = await import('./utils/terminalProgress.ts');
              addLocalMessage(`Fully resetting @${agentToReset}...`, 'system');
              setTerminalProgressIndeterminate();
              try {
                const success = await resetAgent();
                if (success) {
                  addLocalMessage(`Agent @${agentToReset} reset. Select it again to restart setup.`, 'system');
                } else {
                  addLocalMessage(`Failed to reset agent @${agentToReset}`, 'error');
                }
              } finally {
                clearTerminalProgress();
              }
              return;
            }

            if (subCommand === 'create') {
              addLocalMessage('Agent creation not yet implemented. Create a document in your "Agents" folder manually.', 'system');
              return;
            }

            if (subCommand) {
              // Try to activate agent by name
              const activated = await activateAgent(subCommand);
              if (!activated) {
                addLocalMessage(`Agent not found: ${subCommand}`, 'error');
              }
              // Message shown by activationComplete() in useAgent
              return;
            }

            // No subcommand - show interactive menu
            setShowAgentMenu(true);
            return;
          }

          case '/auth': {
            // Trigger MCP server authentication for active agent
            triggerMcpAuth();
            return;
          }

          case '/web':
          case '/websearch': {
            const newState = !isWebSearchEnabled();
            setWebSearchEnabled(newState);
            addLocalMessage(
              `Web search: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          case '/fetch':
          case '/webfetch': {
            const newState = !isWebFetchEnabled();
            setWebFetchEnabled(newState);
            addLocalMessage(
              `Web fetch: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          case '/bash': {
            const newState = !isCodeExecutionEnabled();
            setCodeExecutionEnabled(newState);
            addLocalMessage(
              `Bash execution: ${newState ? 'Enabled' : 'Disabled'}`,
              'system'
            );
            return;
          }

          case '/balance': {
            setShowBalance(true);
            return;
          }

          case '/debug': {
            const dataPath = getWorkspaceDataPath(workspace.id);
            const conversationPath = `${dataPath}/conversation.json`;

            // Construct SDK transcript path: ~/.claude/projects/{projectSlug}/{sessionId}.jsonl
            // SDK converts cwd to slug by replacing / with - (keeps leading -)
            let transcriptPath: string | null = null;
            if (workspace.sessionId) {
              const projectSlug = process.cwd().replace(/\//g, '-');
              transcriptPath = `${homedir()}/.claude/projects/${projectSlug}/${workspace.sessionId}.jsonl`;
            }

            let debugInfo = `**Debug Info**\n\n`;
            debugInfo += `Workspace: ${workspace.name}\n`;
            debugInfo += `Session: ${workspace.sessionId || 'none'}\n\n`;
            debugInfo += `Version: ${getCurrentVersion()}\n\n`;
            debugInfo += `**Files:**\n\n`;
            debugInfo += `file://${conversationPath}\n`;
            if (transcriptPath) {
              debugInfo += `file://${transcriptPath}\n`;
            }

            addLocalMessage(debugInfo, 'assistant');
            return;
          }

          case '/feedback': {
            if (!workspace.sessionId) {
              addLocalMessage('No session transcript available. Start a conversation first.', 'error');
              return;
            }

            const projectSlug = process.cwd().replace(/\//g, '-');
            const transcriptFolder = `${homedir()}/.claude/projects/${projectSlug}`;
            const transcriptPath = `${transcriptFolder}/${workspace.sessionId}.jsonl`;

            // Check if transcript file exists
            const { existsSync } = await import('fs');
            if (!existsSync(transcriptPath)) {
              addLocalMessage(`Transcript file not found: ${transcriptPath}`, 'error');
              return;
            }

            const { execSync } = await import('child_process');
            const platform = process.platform;
            const subject = 'Craft TUI Agent Feedback';
            const recipient = 'beta@craft.do';
            const body = `
Please attach the transcript file from the folder that just opened. 
Filename: ${workspace.sessionId}.jsonl`;

            // open folder of transcript
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

            // Open mailto link
            const mailtoUrl = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            try {
              if (platform === 'darwin') {
                execSync(`open "${mailtoUrl}"`, { stdio: 'ignore' });
              } else if (platform === 'linux') {
                execSync(`xdg-open "${mailtoUrl}"`, { stdio: 'ignore' });
              } else if (platform === 'win32') {
                execSync(`start "" "${mailtoUrl}"`, { stdio: 'ignore' });
              }
              // OSC 8 hyperlinks with underline: \x1b[4m = underline, \x1b[24m = underline off
              const fileLink = `\x1b]8;;file://${transcriptPath}\x07\x1b[4m${workspace.sessionId}.jsonl\x1b[24m\x1b]8;;\x07`;
              const emailLink = `\x1b]8;;mailto:${recipient}\x07\x1b[4m${recipient}\x1b[24m\x1b]8;;\x07`;
              addLocalMessage(`Opening email to ${emailLink} and transcript location...\n\nDrag the file to attach: ${fileLink}`, 'system');
            } catch {
              addLocalMessage(`Could not open email client. Please email ${recipient} and attach:\n${transcriptPath}`, 'error');
            }
            return;
          }

          default:
            addLocalMessage(`Unknown command: ${command}. Type /help for available commands.`, 'error');
            return;
        }
      }

      // Clear local messages when sending a real message
      setLocalMessages([]);

      // Process input for file attachments
      const { text, attachments: fileAttachments, errors } = processInputWithFiles(input);

      // Combine file attachments with pending clipboard attachments
      const allAttachments = [...pendingAttachments, ...fileAttachments];

      // Clear pending attachments
      setPendingAttachments([]);

      // Show any file processing errors
      for (const error of errors) {
        addLocalMessage(error, 'error');
      }

      // Send message with attachments
      await sendMessage(text || input, allAttachments.length > 0 ? allAttachments : undefined);
    },
    [
      exit,
      clearMessages,
      sendMessage,
      addToHistory,
      addLocalMessage,
      onRequestSetup,
      config,
      compactMode,
      tokenUsage,
      showWelcome,
      model,
      setModel,
      workspace,
      setWorkspace,
      isWebSearchEnabled,
      setWebSearchEnabled,
      isWebFetchEnabled,
      setWebFetchEnabled,
      isCodeExecutionEnabled,
      setCodeExecutionEnabled,
      pendingAttachments,
      availableAgents,
      activeAgentName,
      activeAgentMcpServers,
      activateAgent,
      deactivateAgent,
      reloadAgent,
      resetAgent,
      refreshAgents,
      fetchTools,
    ]
  );

  // Handle Ctrl+C to interrupt or exit, and permission responses
  useInput((input, key) => {
    // Handle permission responses (y/n/a)
    if (pendingPermission) {
      if (input.toLowerCase() === 'y') {
        respondToPermission(true, false);  // Allow once
        return;
      } else if (input.toLowerCase() === 'n') {
        respondToPermission(false, false);  // Deny
        return;
      } else if (input.toLowerCase() === 'a') {
        respondToPermission(true, true);  // Always allow this command
        return;
      }
    }

    if (key.ctrl && input === 'c') {
      if (pendingPermission) {
        respondToPermission(false, false); // Deny on Ctrl+C
      } else if (isProcessing) {
        interrupt();
      } else {
        exit();
      }
    }

    // Handle Escape to interrupt or deny permission
    if (key.escape) {
      if (showHelp) {
        setShowHelp(false);
        setStaticResetKey(k => k + 1);
      } else if (pendingPermission) {
        respondToPermission(false, false);
      } else if (isProcessing) {
        interrupt();
      }
    }
  });

  // Combine agent messages with local messages
  const allMessages = [...messages, ...localMessages];

  return (
    <Box flexDirection="column" width="100%" minHeight={20}>
      {/* Messages area (includes welcome banner as static content) */}
      {!showHelp && (
        <Box flexDirection="column">
          <Messages
            resetKey={staticResetKey}
            messages={allMessages}
            isProcessing={isProcessing}
            streamingText={streamingText}
            status={status}
            processingStartTime={processingStartTime}
            hasExecutingTool={hasExecutingTool}
            compact={compactMode}
            showWelcome={showWelcome}
          />
        </Box>
      )}

      {/* Model selector overlay */}
      {showModelSelector && (
        <ModelSelector
          models={models}
          currentModelId={model}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      )}

      {/* Help panel overlay */}
      {showHelp && (
        <HelpPanel onClose={() => {
          setShowHelp(false);
          setStaticResetKey(k => k + 1);
        }} />
      )}

      {/* Agent menu overlay */}
      {showAgentMenu && (
        <AgentMenu
          agents={availableAgents}
          activeAgentName={activeAgentName}
          onAction={handleAgentAction}
          onCancel={handleAgentMenuCancel}
        />
      )}

      {/* Workspace selector overlay */}
      {showWorkspaceSelector && (
        <WorkspaceSelector
          workspaces={getWorkspaces()}
          currentWorkspaceId={workspace.id}
          onSelect={handleWorkspaceSelect}
          onCancel={handleWorkspaceCancel}
          onAdd={handleWorkspaceAddOpen}
          onRename={handleWorkspaceRenameOpen}
          onRemove={handleWorkspaceRemove}
        />
      )}

      {/* Workspace add wizard */}
      {showWorkspaceAdd && (
        <WorkspaceAdd
          onComplete={handleWorkspaceAddComplete}
          onCancel={handleWorkspaceAddCancel}
        />
      )}

      {/* Workspace rename input */}
      {showWorkspaceRename && (
        <WorkspaceRename
          currentName={workspace.name}
          onSubmit={handleWorkspaceRenameSubmit}
          onCancel={handleWorkspaceRenameCancel}
        />
      )}

      {/* API key change input */}
      {showApiKeyChange && (
        <ApiKeyChange
          onSubmit={handleApiKeySubmit}
          onCancel={handleApiKeyCancel}
        />
      )}

      {/* Balance / AI credits top-up */}
      {showBalance && (
        <Balance onClose={() => setShowBalance(false)} />
      )}

      {/* MCP server authentication for sub-agents */}
      {pendingMcpAuth && (
        <McpAuth
          servers={pendingMcpAuth.servers}
          workspaceId={workspace.id}
          agentId={pendingMcpAuth.agentId}
          onComplete={completeMcpAuth}
          onCancel={cancelMcpAuth}
        />
      )}

      {/* API key authentication for REST API integrations */}
      {pendingApiAuth && (
        <ApiAuth
          apis={pendingApiAuth.apis}
          workspaceId={workspace.id}
          agentId={pendingApiAuth.agentId}
          onComplete={completeApiAuth}
          onCancel={cancelApiAuth}
        />
      )}

      {/* Agent review (concerns from extraction that need user input) */}
      {pendingReview && (
        <Box marginTop={1} paddingX={1}>
          <AgentReview
            agentName={pendingReview.agentName}
            concerns={pendingReview.concerns}
            onSubmit={completeReview}
            onSkip={skipReview}
          />
        </Box>
      )}

      {/* Input + Status bar + Header together at bottom */}
      <Box flexDirection="column" width="100%" paddingX={1}>
        {/* Permission prompt */}
        {pendingPermission && (
          <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
            <Text color="yellow" bold>⚠ Permission Required</Text>
            <Text>Tool: <Text color="cyan">{pendingPermission.toolName}</Text></Text>
            <Text dimColor>Command: <Text>{pendingPermission.command}</Text></Text>
            <Box marginTop={1}>
              <Text>Allow? </Text>
              <Text color="green" bold>[Y]es</Text>
              <Text> / </Text>
              <Text color="red" bold>[N]o</Text>
              <Text> / </Text>
              <Text color="blue" bold>[A]lways</Text>
              <Text dimColor> (for this command)</Text>
            </Box>
          </Box>
        )}
        {/* AskUserQuestion prompt */}
        {pendingQuestion && (
          <Box marginBottom={1}>
            <AskUserQuestion
              questions={pendingQuestion.questions}
              onSubmit={respondToQuestion}
            />
          </Box>
        )}
        {!showModelSelector && !showHelp && !showAgentMenu && !showWorkspaceSelector && !showWorkspaceAdd && !showWorkspaceRename && !showApiKeyChange && !showBalance && !pendingPermission && !pendingQuestion && !pendingMcpAuth && !pendingApiAuth && !pendingReview && (
          <Input
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            onPastedText={handlePastedText}
            disabled={isProcessing}
            history={history}
            attachmentCount={pendingAttachments.length}
            attachmentLabel={attachmentLabel}
            availableAgents={availableAgents}
            activeAgentName={activeAgentName ?? undefined}
            columns={terminalColumns}
          />
        )}
        <Header
          connected={connected}
          model={model}
          mcpUrl={workspace.mcpUrl}
          workspaceName={workspace.name}
          contextTokens={tokenUsage.contextTokens}
          costUsd={tokenUsage.costUsd}
          authType={getAuthType()}
          activeAgentName={activeAgentName ?? undefined}
          agentsLoading={agentsLoading}
        />
      </Box>
    </Box>
  );
};
