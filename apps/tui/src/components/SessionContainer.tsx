import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { Box, useApp, useInput, Text } from 'ink';
import { Header } from './Header.tsx';
import { Messages, type Message } from './Messages.tsx';
import { Input } from './Input.tsx';
import { ModelSelector } from './ModelSelector.tsx';
import { MODELS } from '@craft-agent/shared/config';
import { AgentMenu, type AgentAction } from './AgentMenu.tsx';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import { WorkspaceRename } from './WorkspaceRename.tsx';
import { ApiKeyChange } from './ApiKeyChange.tsx';
import { ClaudeMaxAuth } from './ClaudeMaxAuth.tsx';
import { CraftCreditsAuth } from './CraftCreditsAuth.tsx';
import { AskUserQuestion } from './AskUserQuestion.tsx';
import { TodoList } from './TodoList.tsx';
import { ApiAuth } from './ApiAuth.tsx';
import { PlanMenu, type PlanAction } from './PlanMenu.tsx';
import { PlanSelector, type PlanFile } from './PlanSelector.tsx';
import { SessionMenu } from './SessionMenu.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { Balance } from './Balance.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import type { RecoveryAction } from '@craft-agent/shared/agent';
import { Settings, type SettingsAction } from './Settings.tsx';
import { AuthModeOptions } from './AuthModeOptions.tsx';
import {
  useAgent,
  useHistory,
  useResize,
  useModalState,
  useCommands,
  useWorkspaceHandlers,
  useMentionHandler,
  useAgentMenuHandlers,
  useSettingsHandlers,
} from '../hooks/index.ts';
import { isShiftTab, isClearScreen, isExit, isSafeModeToggle } from '../keyboard/index.ts';
import {
  PERMISSION_MODE_MESSAGES,
  PERMISSION_MODE_PROMPTS,
} from '@craft-agent/shared/agents';
import { getPermissionMode, type PermissionMode } from '@craft-agent/shared/agent';
import { useGlobalContext } from '../context/GlobalContext.tsx';
import {
  getWorkspaces,
  getAuthType,
  clearAllConfig,
  getTokenDisplay,
  getShowCost,
  type TokenDisplayMode,
} from '@craft-agent/shared/config';
import {
  loadSession,
  listPlanFiles,
  deletePlanFile,
  listSessions,
  getOrCreateSessionById,
  type SessionConfig,
  type SessionMetadata,
} from '@craft-agent/shared/sessions';
import { processInputWithFiles, readClipboard, readFileAttachment, type FileAttachment } from '@craft-agent/shared/utils';
import { debug } from '@craft-agent/shared/utils';
import type { CraftAgentConfig } from '@craft-agent/shared/agent';
import { getCurrentVersion } from '@craft-agent/shared/version';
import { checkAndUpdate } from '@craft-agent/shared/version';

export interface SessionContainerProps {
  config: CraftAgentConfig;
  session: SessionConfig;  // Current session (primary isolation boundary)
  onRequestSetup?: () => void;
  initialAgent?: string;
  initialPrompt?: string;
  initialError?: string;
}

/**
 * SessionContainer holds ALL session-scoped state.
 *
 * IMPORTANT: This component is rendered with key={session.id} in App.tsx.
 * When the session changes (workspace switch, /clear, --new), React unmounts
 * this entire component and mounts a fresh instance. This automatically resets:
 * - All useState hooks
 * - All useRef hooks
 * - All useEffect cleanup runs, then fresh effects run on mount
 *
 * Session is the primary isolation boundary - workspace is just infrastructure.
 * No manual cleanup needed - React's lifecycle handles everything.
 */
export const SessionContainer: React.FC<SessionContainerProps> = ({
  config,
  session,
  onRequestSetup,
  initialAgent,
  initialPrompt,
  initialError,
}) => {
  const { exit } = useApp();
  const { model, setModel, workspace, setWorkspace, setSession, startNewSession, resetSession, addUsage } = useGlobalContext();

  // Centralized exit function
  const exitApp = useCallback(() => {
    debug('[SessionContainer] exitApp called');
    // Log stack trace to see who called us
    debug('[SessionContainer] exitApp stack:', new Error().stack);
    exit();
    process.exit(0);
  }, [exit]);

  // Callback to update session when SDK session ID is captured
  const handleSdkSessionIdUpdate = useCallback((sdkSessionId: string) => {
    debug('[SessionContainer] handleSdkSessionIdUpdate called:', sdkSessionId);
    setSession(prev => {
      debug('[SessionContainer] setSession updating from:', prev.sdkSessionId, 'to:', sdkSessionId);
      return { ...prev, sdkSessionId };
    });
  }, [setSession]);

  // Create config with session for the agent hook
  const agentConfig: CraftAgentConfig = useMemo(() => ({
    ...config,
    session,  // Include session for session-based conversation storage
    onSdkSessionIdUpdate: handleSdkSessionIdUpdate,
  }), [config, session, handleSdkSessionIdUpdate]);

  // Use the agent hook - this creates a FRESH agent instance per session
  // because SessionContainer remounts when session.id changes (key={session.id})
  const {
    messages,
    isProcessing,
    streamingText,
    status,
    processingStartTime,
    connected,
    tokenUsage,
    typedError,
    dismissTypedError,
    pendingPermission,
    pendingQuestion,
    hasExecutingTool,
    sendMessage,
    interrupt,
    respondToPermission,
    respondToQuestion,
    // Agent-related
    availableAgents,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    resetAgentInstance,
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
    triggerApiAuth,
    // Permission mode (safe/ask/allow-all)
    permissionMode,
    cycleMode,
    setSessionPermissionMode,
    // Legacy safe mode flag (deprecated - use permissionMode instead)
    safeMode,
    // Plan handling
    activePlan,
    cancelPlan,
    approvePlan,
    // Todos (from TodoWrite tool)
    todos,
    // Ultrathink mode
    isUltrathink,
  } = useAgent(agentConfig);

  // Track cumulative usage - update global when workspace usage changes
  // Skip the first update to avoid double-counting loaded session usage
  const prevUsageRef = useRef({ costUsd: 0, inputTokens: 0, outputTokens: 0 });
  const isFirstUsageUpdateRef = useRef(true);
  useEffect(() => {
    // Skip the first update - this is loaded/restored data, already counted in cumulative
    if (isFirstUsageUpdateRef.current) {
      isFirstUsageUpdateRef.current = false;
      prevUsageRef.current = {
        costUsd: tokenUsage.costUsd,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
      };
      return;
    }

    const delta = {
      costUsd: tokenUsage.costUsd - prevUsageRef.current.costUsd,
      inputTokens: tokenUsage.inputTokens - prevUsageRef.current.inputTokens,
      outputTokens: tokenUsage.outputTokens - prevUsageRef.current.outputTokens,
    };
    if (delta.costUsd > 0 || delta.inputTokens > 0 || delta.outputTokens > 0) {
      addUsage(delta);
    }
    prevUsageRef.current = {
      costUsd: tokenUsage.costUsd,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    };
  }, [tokenUsage.costUsd, tokenUsage.inputTokens, tokenUsage.outputTokens, addUsage]);

  const { history, addToHistory } = useHistory();
  const [localMessages, setLocalMessages] = useState<Message[]>(() => {
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
  const [tokenDisplayMode, setTokenDisplayMode] = useState<TokenDisplayMode>(getTokenDisplay());
  const [showCostSetting, setShowCostSetting] = useState(getShowCost());
  const [showClockSetting, setShowClockSetting] = useState(getShowClock());
  const [safeModeSetting, setSafeModeSetting] = useState(getSafeMode());
  // Only show welcome banner on truly new sessions (no prior messages)
  // This prevents duplicate banners when switching to workspaces with existing sessions
  const [showWelcome, setShowWelcome] = useState(() => {
    const storedSession = loadSession(session.workspaceRootPath, session.id);
    return !storedSession?.messages?.length;
  });
  const [staticResetKey, setStaticResetKey] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);

  // Ctrl+C double-press exit state
  const [lastCtrlCTime, setLastCtrlCTime] = useState<number | null>(null);
  const [showExitWarning, setShowExitWarning] = useState(false);

  // Plan mode toggle warning state (when trying to toggle during processing)
  const [showPlanToggleWarning, setShowPlanToggleWarning] = useState(false);

  // Auto-dismiss exit warning after 1000ms
  useEffect(() => {
    if (showExitWarning) {
      const timer = setTimeout(() => {
        setShowExitWarning(false);
        setLastCtrlCTime(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showExitWarning]);

  // Auto-dismiss plan toggle warning after 1000ms
  useEffect(() => {
    if (showPlanToggleWarning) {
      const timer = setTimeout(() => {
        setShowPlanToggleWarning(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showPlanToggleWarning]);

  // Consolidated modal state - replaces 11 separate useState calls
  const { activeModal, openModal, closeModal, isOpen, hasOpenModal } = useModalState();

  // Track if we've processed initial startup params
  const initialStartupDoneRef = useRef(false);
  const initialPromptPendingRef = useRef<string | null>(initialPrompt ?? null);

  // Track if agent loading has started
  const agentsLoadingStartedRef = useRef(false);
  if (agentsLoading) {
    agentsLoadingStartedRef.current = true;
  }

  // Handle initial agent activation and prompt on startup
  useEffect(() => {
    if (initialStartupDoneRef.current) return;

    if (initialAgent) {
      if (!agentsLoadingStartedRef.current) return;
      if (agentsLoading) return;
    }

    const runInitialStartup = async () => {
      initialStartupDoneRef.current = true;

      if (initialAgent) {
        debug('[SessionContainer] Auto-activating initial agent:', initialAgent);

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
          initialPromptPendingRef.current = null;
          return;
        }

        const result = await activateAgent(initialAgent);
        debug('[SessionContainer] Initial agent activation result:', result);

        if (result === 'pending_auth') {
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

      if (initialPromptPendingRef.current) {
        debug('[SessionContainer] Auto-sending initial prompt');
        await sendMessage(initialPromptPendingRef.current);
        initialPromptPendingRef.current = null;
      }
    };

    runInitialStartup();
  }, [agentsLoading, availableAgents, initialAgent, activateAgent, sendMessage]);

  // Handle initial prompt after auth completes
  useEffect(() => {
    if (
      initialPromptPendingRef.current &&
      !pendingMcpAuth &&
      !pendingApiAuth &&
      activeAgentName
    ) {
      debug('[SessionContainer] Auth completed, sending pending initial prompt');
      const prompt = initialPromptPendingRef.current;
      initialPromptPendingRef.current = null;
      sendMessage(prompt);
    }
  }, [pendingMcpAuth, pendingApiAuth, activeAgentName, sendMessage]);

  // Handle terminal resize
  const handleTerminalResize = useCallback(() => {
    setStaticResetKey(k => k + 1);
  }, []);
  const { columns: terminalColumns } = useResize(handleTerminalResize);

  // Check for updates on startup
  useEffect(() => {
    checkAndUpdate();
  }, []);

  const addLocalMessage = useCallback((content: string, type: Message['type'] = 'system') => {
    setLocalMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, type, content, timestamp: Date.now() },
    ]);
  }, []);

  // Command handling hook - handles all /commands
  const { handleCommand } = useCommands({
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
  });

  // Workspace handlers hook - handles workspace selector actions
  const workspaceHandlers = useWorkspaceHandlers({
    workspace,
    setWorkspace,
    openModal,
    closeModal,
    addMessage: addLocalMessage,
  });

  // Mention handler hook - handles @mentions
  const { handleMention } = useMentionHandler({
    availableAgents,
    activateAgent,
    deactivateAgent,
    openModal,
    sendMessage,
  });

  const handleModelSelect = useCallback((modelId: string) => {
    closeModal();
    setModel(modelId);
  }, [setModel, closeModal]);

  const handleModelCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Agent menu handlers hook
  const { handleAgentAction: rawHandleAgentAction, handleAgentMenuCancel } = useAgentMenuHandlers({
    closeModal,
    openModal,
    activateAgent,
    deactivateAgent,
    reloadAgent,
    resetAgent,
    refreshAgents,
    fetchTools,
    triggerMcpAuth,
    triggerApiAuth,
    activeAgentName,
    activeAgentDefinition,
    activeAgentMcpServers,
  });

  // Wrap to add message display
  const handleAgentAction = useCallback(async (action: AgentAction) => {
    const result = await rawHandleAgentAction(action);
    if (result.message) {
      addLocalMessage(result.message.content, result.message.type);
    }
  }, [rawHandleAgentAction, addLocalMessage]);

  // Settings handlers hook
  const settingsHandlers = useSettingsHandlers({
    closeModal,
    openModal,
    setCompactMode,
    setTokenDisplayMode,
    setShowCostSetting,
    setShowClockSetting,
    setSafeModeSetting,
    addMessage: addLocalMessage,
    resetAgentInstance,
    isProcessing,
  });

  const handleErrorAction = useCallback((action: RecoveryAction) => {
    dismissTypedError();
    if (action.action === 'credits') {
      openModal('balance');
    } else if (action.action === 'settings') {
      openModal('settings');
    } else if (action.action === 'reauth') {
      openModal('claudeMaxAuth');
    }
  }, [dismissTypedError, openModal]);

  // Reauth selector handler - after deleting selected credentials, trigger auth flow
  const handleReauthConfirm = useCallback((mcpNames: string[], apiNames: string[]) => {
    closeModal();
    // Trigger the auth flows for deleted credentials
    if (mcpNames.length > 0) {
      triggerMcpAuth();
    }
    if (apiNames.length > 0) {
      triggerApiAuth();
    }
  }, [closeModal, triggerMcpAuth, triggerApiAuth]);

  // Plan menu handler
  const handlePlanAction = useCallback((action: PlanAction) => {
    closeModal();

    switch (action.type) {
      case 'start':
        // Start Craft Agents safe mode (same as /safe and SHIFT+TAB)
        setSessionPermissionMode('safe');
        addLocalMessage(PERMISSION_MODE_MESSAGES['safe'], 'system');
        sendMessage(PERMISSION_MODE_PROMPTS['safe']);
        break;
      case 'plans':
        // Open unified plan selector (list/load/delete)
        openModal('planSelector');
        break;
      case 'view':
        if (activePlan) {
          addLocalMessage(`Active plan: ${activePlan.title}\nState: ${activePlan.state}\nSteps: ${activePlan.steps.length}`, 'system');
        } else {
          addLocalMessage('No active plan.', 'system');
        }
        break;
      case 'approve':
        if (activePlan) {
          approvePlan();
          addLocalMessage('Plan approved. Proceeding with execution...', 'system');
        }
        break;
      case 'cancel':
        if (activePlan) {
          const title = activePlan.title;
          cancelPlan();
          addLocalMessage(`Plan cancelled: ${title}`, 'system');
        }
        break;
    }
  }, [activePlan, approvePlan, cancelPlan, closeModal, openModal, addLocalMessage, sendMessage, setSessionPermissionMode]);

  // Plan selector handler - loads selected plan as attachment
  const handlePlanSelect = useCallback((plan: PlanFile) => {
    closeModal();
    const attachment = readFileAttachment(plan.path);
    if (attachment) {
      setPendingAttachments(prev => [...prev, attachment]);
      // Clean the name for display
      const displayName = plan.name
        .replace(/^==PLAN==\s*/, '')
        .replace(/\s*\(\d{8}-\d{6}\)$/, '')
        .trim();
      addLocalMessage(`Plan "${displayName}" loaded. Send a message to execute, or type "approve" to run immediately.`, 'system');
    } else {
      addLocalMessage(`Failed to read plan file: ${plan.path}`, 'error');
    }
  }, [closeModal, addLocalMessage]);

  // Plan selector delete handler
  const handlePlanDelete = useCallback((plans: PlanFile[]) => {
    closeModal();
    let deleted = 0;
    for (const plan of plans) {
      if (deletePlanFile(session.workspaceRootPath, session.id, plan.name)) {
        deleted++;
      }
    }
    if (deleted > 0) {
      addLocalMessage(`Deleted ${deleted} plan${deleted > 1 ? 's' : ''}.`, 'system');
    } else {
      addLocalMessage('Failed to delete plans.', 'error');
    }
  }, [closeModal, addLocalMessage, session.id, session.workspaceRootPath]);

  // Session menu handler - resumes selected session
  const handleSessionSelect = useCallback((selectedSession: SessionMetadata) => {
    const fullSession = getOrCreateSessionById(workspace.rootPath, selectedSession.id);
    setSession(fullSession);
    closeModal();
  }, [workspace.rootPath, setSession, closeModal]);

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

  const handleRemoveAttachment = useCallback(() => {
    setPendingAttachments(prev => {
      if (prev.length > 0) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const handleClearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  // Handle Ctrl+C from Input component (double-press to exit)
  const handleInputCtrlC = useCallback(() => {
    const now = Date.now();
    const timeSinceLastCtrlC = lastCtrlCTime ? now - lastCtrlCTime : null;
    debug('[SessionContainer] handleInputCtrlC called:', { lastCtrlCTime, now, timeSinceLastCtrlC });
    if (lastCtrlCTime && (now - lastCtrlCTime) < 1000) {
      debug('[SessionContainer] Double Ctrl+C detected, exiting');
      exitApp();
    } else {
      debug('[SessionContainer] First Ctrl+C, showing warning');
      setLastCtrlCTime(now);
      setShowExitWarning(true);
    }
  }, [lastCtrlCTime, exitApp]);

  const handlePastedText = useCallback((text: string) => {
    const { attachments, errors } = processInputWithFiles(text);

    if (attachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...attachments]);
    }

    for (const error of errors) {
      addLocalMessage(error, 'error');
    }
  }, [addLocalMessage]);

  const attachmentLabel = useMemo(() => {
    if (pendingAttachments.length === 0) return '';
    if (pendingAttachments.length === 1) {
      const att = pendingAttachments[0];
      if (!att) return '1 file';
      const icon = att.type === 'image' ? '🖼' : att.type === 'pdf' ? '📄' : '📝';
      // Truncate long names (especially plan files with ==PLAN== prefix)
      let displayName = att.name;
      // Clean plan file names
      displayName = displayName.replace(/^==PLAN==\s*/, '').replace(/\s*\(\d{8}-\d{6}\)\.md$/, '');
      // Truncate to max 25 chars
      if (displayName.length > 25) {
        displayName = displayName.slice(0, 22) + '...';
      }
      return `${icon} ${displayName}`;
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
      addToHistory(input);

      // Handle @mentions using hook
      if (input.startsWith('@')) {
        const result = await handleMention(input);
        if (result.handled) {
          if (result.message) {
            addLocalMessage(result.message.content, result.message.type);
          }
          return;
        }
      }

      // Handle slash commands using hook
      if (input.startsWith('/')) {
        const result = await handleCommand(input);
        if (result.handled) {
          if (result.message) {
            addLocalMessage(result.message.content, result.message.type);
          }
          // Send message to agent if command requested it
          if (result.sendToAgent) {
            await sendMessage(result.sendToAgent);
          }
          return;
        }
      }

      // Clear local messages when sending a real message
      setLocalMessages([]);

      const { text, attachments: fileAttachments, errors } = processInputWithFiles(input);
      const allAttachments = [...pendingAttachments, ...fileAttachments];

      setPendingAttachments([]);

      for (const error of errors) {
        addLocalMessage(error, 'error');
      }

      await sendMessage(text || input, allAttachments.length > 0 ? allAttachments : undefined);
    },
    [addToHistory, handleMention, handleCommand, addLocalMessage, pendingAttachments, sendMessage]
  );

  // Handle Ctrl+C to interrupt or exit, and permission responses
  useInput((input, key) => {
    const charCode = input.charCodeAt(0);
    debug('[SessionContainer] main useInput received:', { charCode, input: charCode === 3 ? 'Ctrl+C' : input, key });

    if (isOpen('logoutConfirm')) {
      if (input.toLowerCase() === 'y') {
        clearAllConfig().then(() => exitApp());
        return;
      } else if (input.toLowerCase() === 'n' || key.escape) {
        closeModal();
        return;
      }
      return;
    }

    if (pendingPermission) {
      // Permission request: Y/N/A
      if (input.toLowerCase() === 'y') {
        respondToPermission(true, false);
        return;
      } else if (input.toLowerCase() === 'n') {
        respondToPermission(false, false);
        return;
      } else if (input.toLowerCase() === 'a') {
        respondToPermission(true, true);
        return;
      }
    }

    // SHIFT+TAB: Cycle Permission Mode (safe → ask → allow-all → safe)
    if (isShiftTab(input, key)) {
      // Cycle to the next mode
      const newMode = cycleMode();
      // Show mode change message and send prompt to Claude
      addLocalMessage(PERMISSION_MODE_MESSAGES[newMode], 'system');
      if (!isProcessing) {
        sendMessage(PERMISSION_MODE_PROMPTS[newMode]);
      }
      return;
    }

    // Ctrl+L: Clear screen (like /clear command)
    if (isClearScreen(input, key)) {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      resetSession();
      return;
    }

    // Ctrl+S: Toggle Safe Mode
    if (isSafeModeToggle(input, key)) {
      const newMode = !safeModeSetting;
      setSafeMode(newMode);
      setSafeModeSetting(newMode);
      addLocalMessage(`Safe Mode ${newMode ? 'enabled' : 'disabled'}`, 'info');
      return;
    }

    // Ctrl+D: Exit (like /exit command) - only when input is empty
    if (isExit(input, key) && !isProcessing && !hasOpenModal) {
      exitApp();
      return;
    }

    if (input === '\x03' || (key.ctrl && input === 'c')) {
      debug('[SessionContainer] main useInput Ctrl+C detected:', { pendingPermission: !!pendingPermission, isProcessing, hasOpenModal, pendingQuestion: !!pendingQuestion, pendingMcpAuth: !!pendingMcpAuth, pendingApiAuth: !!pendingApiAuth });
      if (pendingPermission) {
        debug('[SessionContainer] Denying permission');
        respondToPermission(false, false);
      } else if (isProcessing) {
        debug('[SessionContainer] Interrupting processing');
        interrupt();
      } else {
        // Only handle if Input is not rendered (Input handles its own Ctrl+C)
        const inputIsRendered = !hasOpenModal && !pendingPermission && !pendingQuestion && !pendingMcpAuth && !pendingApiAuth;
        debug('[SessionContainer] inputIsRendered:', inputIsRendered);
        if (!inputIsRendered) {
          // Double-press logic for modals/overlays
          debug('[SessionContainer] Input NOT rendered, handling Ctrl+C in main handler');
          const now = Date.now();
          if (lastCtrlCTime && (now - lastCtrlCTime) < 1000) {
            debug('[SessionContainer] Double Ctrl+C in main handler, exiting');
            exitApp();
          } else {
            debug('[SessionContainer] First Ctrl+C in main handler, showing warning');
            setLastCtrlCTime(now);
            setShowExitWarning(true);
          }
        } else {
          debug('[SessionContainer] Input IS rendered, skipping (Input handles it)');
        }
        // If inputIsRendered, do nothing - Input component handles Ctrl+C via onCtrlC
      }
    }

    if (key.escape) {
      if (isOpen('help')) {
        closeModal();
        setStaticResetKey(k => k + 1);
      } else if (isOpen('planReview') && !activePlan) {
        // Close /plan view when there's no active plan
        closeModal();
      } else if (pendingPermission) {
        respondToPermission(false, false);
      } else if (pendingQuestion) {
        // AskUserQuestion handles Escape itself - don't also interrupt
        return;
      } else if (isProcessing) {
        interrupt();
      }
    }
  });

  const allMessages = [...messages, ...localMessages];

  return (
    <Box flexDirection="column" width="100%" minHeight={20}>
      {/* Todo list (from TodoWrite tool) */}
      {todos.length > 0 && !isOpen('help') && (
        <TodoList todos={todos} />
      )}

      {/* Messages area */}
      {!isOpen('help') && (
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
            isUltrathink={isUltrathink}
          />
        </Box>
      )}

      {/* Model selector overlay */}
      {isOpen('modelSelector') && (
        <ModelSelector
          models={MODELS}
          currentModelId={model}
          onSelect={handleModelSelect}
          onCancel={handleModelCancel}
        />
      )}

      {/* Help panel overlay */}
      {isOpen('help') && (
        <HelpPanel onClose={() => {
          closeModal();
          setStaticResetKey(k => k + 1);
        }} />
      )}

      {/* Agent menu overlay */}
      {isOpen('agentMenu') && (
        <AgentMenu
          agents={availableAgents}
          activeAgentName={activeAgentName}
          onAction={handleAgentAction}
          onCancel={handleAgentMenuCancel}
        />
      )}

      {/* Credentials viewer overlay */}
      {isOpen('credentialsViewer') && activeAgentDefinition && activeAgentName && (
        <CredentialsViewer
          definition={activeAgentDefinition}
          agentName={activeAgentName}
          getCredential={getAgentCredential}
          saveCredential={saveAgentCredential}
          onClose={closeModal}
        />
      )}

      {/* Reauth selector overlay */}
      {isOpen('reauthSelector') && activeAgentDefinition && activeAgentName && (
        <ReauthSelector
          definition={activeAgentDefinition}
          agentName={activeAgentName}
          getCredential={getAgentCredential}
          clearCredentials={clearAgentCredentials}
          onConfirm={handleReauthConfirm}
          onCancel={closeModal}
        />
      )}

      {/* Plan menu overlay */}
      {isOpen('planMenu') && (
        <PlanMenu
          activePlan={activePlan}
          onAction={handlePlanAction}
          onCancel={closeModal}
        />
      )}

      {/* Plan selector overlay */}
      {isOpen('planSelector') && (
        <PlanSelector
          plans={listPlanFiles(session.workspaceRootPath, session.id)}
          onSelect={handlePlanSelect}
          onDelete={handlePlanDelete}
          onCancel={closeModal}
        />
      )}

      {/* Plan review overlay (/plan view command) */}
      {isOpen('planReview') && activePlan && (
        <PlanReview
          plan={activePlan}
          sessionId={session.id}
          onApprove={(modifiedPlan, savedPath) => {
            closeModal();
            respondToPlanReview({ action: 'approve', modifiedPlan, savedPath });
          }}
          onRefine={(feedback) => {
            closeModal();
            respondToPlanReview({ action: 'refine', feedback });
          }}
          onSaveOnly={(modifiedPlan, savedPath) => {
            closeModal();
            respondToPlanReview({ action: 'saveOnly', modifiedPlan, savedPath });
          }}
          onCancel={closeModal}
        />
      )}

      {/* Plan review overlay - no active plan message */}
      {isOpen('planReview') && !activePlan && (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>No active plan. Use '/plan start' to create one or '/plan list' to view saved plans.</Text>
          <Text dimColor>Press Escape to close.</Text>
        </Box>
      )}

      {/* Session menu overlay */}
      {isOpen('sessionMenu') && (
        <SessionMenu
          sessions={listSessions(workspace.rootPath)}
          currentSessionId={session.id}
          onSelect={handleSessionSelect}
          onCancel={closeModal}
        />
      )}

      {/* Workspace selector overlay */}
      {isOpen('workspaceSelector') && (
        <WorkspaceSelector
          workspaces={getWorkspaces()}
          currentWorkspaceId={workspace.id}
          onSelect={workspaceHandlers.handleWorkspaceSelect}
          onCancel={workspaceHandlers.handleWorkspaceCancel}
          onRename={workspaceHandlers.handleWorkspaceRenameOpen}
          onRemove={workspaceHandlers.handleWorkspaceRemove}
        />
      )}

      {/* Workspace rename input */}
      {isOpen('workspaceRename') && (
        <WorkspaceRename
          currentName={workspace.name}
          onSubmit={workspaceHandlers.handleWorkspaceRenameSubmit}
          onCancel={workspaceHandlers.handleWorkspaceRenameCancel}
        />
      )}

      {/* API key change input */}
      {isOpen('apiKeyChange') && (
        <ApiKeyChange
          onSubmit={settingsHandlers.handleApiKeySubmit}
          onCancel={settingsHandlers.handleApiKeyCancel}
        />
      )}

      {/* Claude Max auth input */}
      {isOpen('claudeMaxAuth') && (
        <ClaudeMaxAuth
          onSubmit={settingsHandlers.handleClaudeMaxSubmit}
          onCancel={settingsHandlers.handleClaudeMaxCancel}
        />
      )}

      {/* Craft Credits auth */}
      {isOpen('craftCreditsAuth') && (
        <CraftCreditsAuth
          onSubmit={settingsHandlers.handleCraftCreditsSubmit}
          onCancel={settingsHandlers.handleCraftCreditsCancel}
        />
      )}

      {/* Balance / AI credits */}
      {isOpen('balance') && (
        <Balance
          authType={getAuthType()}
          onClose={closeModal}
        />
      )}

      {/* Settings menu */}
      {isOpen('settings') && (
        <Settings
          compactMode={compactMode}
          currentAuthType={getAuthType()}
          tokenDisplay={tokenDisplayMode}
          showCost={showCostSetting}
          showClock={showClockSetting}
          safeMode={safeModeSetting}
          onAction={settingsHandlers.handleSettingsAction}
          onCancel={settingsHandlers.handleSettingsCancel}
        />
      )}

      {/* Auth mode options (use existing vs re-authenticate) */}
      {isOpen('authModeOptions') && settingsHandlers.pendingAuthSwitch && (
        <AuthModeOptions
          authType={settingsHandlers.pendingAuthSwitch.authType}
          maskedCredential={settingsHandlers.pendingAuthSwitch.maskedCredential}
          onUseExisting={settingsHandlers.handleAuthModeUseExisting}
          onReauthenticate={settingsHandlers.handleAuthModeReauthenticate}
          onCancel={settingsHandlers.handleAuthModeCancel}
        />
      )}

      {/* Logout confirmation */}
      {isOpen('logoutConfirm') && (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginX={1}>
          <Text color="red" bold>⚠ Logout</Text>
          <Text>This will clear all settings and credentials.</Text>
          <Text>You will need to run setup again to use the app.</Text>
          <Box marginTop={1}>
            <Text>Continue? </Text>
            <Text color="green" bold>[Y]es</Text>
            <Text> / </Text>
            <Text color="red" bold>[N]o</Text>
          </Box>
        </Box>
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

      {/* Input + Status bar + Header together at bottom */}
      <Box flexDirection="column" width="100%" paddingX={1}>
        {/* Typed error banner */}
        {typedError && (
          <ErrorBanner
            error={typedError}
            onAction={handleErrorAction}
            onDismiss={dismissTypedError}
          />
        )}

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

        {/* AskUserQuestion prompt (SDK built-in) */}
        {pendingQuestion && (
          <Box marginBottom={1}>
            <AskUserQuestion
              questions={pendingQuestion.questions}
              onSubmit={respondToQuestion}
            />
          </Box>
        )}

        {!hasOpenModal && !pendingPermission && !pendingQuestion && !pendingMcpAuth && !pendingApiAuth && (
          <Input
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            onPastedText={handlePastedText}
            onCtrlC={handleInputCtrlC}
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
          workspaceName={workspace.name}
          contextTokens={tokenUsage.contextTokens}
          inputTokens={tokenUsage.inputTokens}
          outputTokens={tokenUsage.outputTokens}
          costUsd={tokenUsage.costUsd}
          authType={getAuthType()}
          activeAgentName={activeAgentName ?? undefined}
          agentsLoading={agentsLoading}
          tokenDisplay={tokenDisplayMode}
          showCost={showCostSetting}
          showClock={showClockSetting}
          version={getCurrentVersion()}
          permissionMode={permissionMode}
          exitWarning={showExitWarning}
          planToggleWarning={showPlanToggleWarning}
        />
      </Box>
    </Box>
  );
};
