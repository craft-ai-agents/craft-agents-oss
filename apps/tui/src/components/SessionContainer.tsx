import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { Box, useApp, useInput, Text } from 'ink';
import { Header } from './Header.tsx';
import { Messages, type Message } from './Messages.tsx';
import { Input } from './Input.tsx';
import { ModelSelector } from './ModelSelector.tsx';
import { MODELS } from '../../../../src/config/models.ts';
import { AgentMenu, type AgentAction } from './AgentMenu.tsx';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import { WorkspaceAdd } from './WorkspaceAdd.tsx';
import { WorkspaceRename } from './WorkspaceRename.tsx';
import { ApiKeyChange } from './ApiKeyChange.tsx';
import { ClaudeMaxAuth } from './ClaudeMaxAuth.tsx';
import { AskUserQuestion } from './AskUserQuestion.tsx';
import { McpAuth } from './McpAuth.tsx';
import { ApiAuth } from './ApiAuth.tsx';
import { AgentReview } from './AgentReview.tsx';
import { HelpPanel } from './HelpPanel.tsx';
import { Balance } from './Balance.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import type { RecoveryAction } from '../../../../src/agent/errors.ts';
import { Settings, type SettingsAction } from './Settings.tsx';
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
import { useGlobalContext } from '../context/GlobalContext.tsx';
import {
  getWorkspaces,
  getAuthType,
  clearAllConfig,
  getTokenDisplay,
  getShowCost,
  loadSession,
  type TokenDisplayMode,
  type Session,
} from '../../../../src/config/storage.ts';
import { processInputWithFiles, readClipboard, type FileAttachment } from '../../../../src/utils/files.ts';
import { debug } from '../../../../src/utils/debug.ts';
import type { CraftAgentConfig } from '../../../../src/agent/craft-agent.ts';
import { getCurrentVersion } from '../../../../src/version/version.ts';
import { checkAndUpdate } from '../../../../src/version/install.ts';

export interface SessionContainerProps {
  config: CraftAgentConfig;
  session: Session;  // Current session (primary isolation boundary)
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
  const { model, setModel, workspace, setWorkspace, setSession, startNewSession, addUsage } = useGlobalContext();

  // Centralized exit function
  const exitApp = useCallback(() => {
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
    clearMessages,
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
    // Review mode
    pendingReview,
    completeReview,
    skipReview,
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
  // Only show welcome banner on truly new sessions (no prior messages)
  // This prevents duplicate banners when switching to workspaces with existing sessions
  const [showWelcome, setShowWelcome] = useState(() => {
    const storedSession = loadSession(session.id);
    return !storedSession?.messages?.length;
  });
  const [staticResetKey, setStaticResetKey] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);

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
      !pendingReview &&
      activeAgentName
    ) {
      debug('[SessionContainer] Auth completed, sending pending initial prompt');
      const prompt = initialPromptPendingRef.current;
      initialPromptPendingRef.current = null;
      sendMessage(prompt);
    }
  }, [pendingMcpAuth, pendingApiAuth, pendingReview, activeAgentName, sendMessage]);

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
    exitApp,
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
    addMessage: addLocalMessage,
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

    if (input === '\x03' || (key.ctrl && input === 'c')) {
      if (pendingPermission) {
        respondToPermission(false, false);
      } else if (isProcessing) {
        interrupt();
      } else {
        exitApp();
      }
    }

    if (key.escape) {
      if (isOpen('help')) {
        closeModal();
        setStaticResetKey(k => k + 1);
      } else if (pendingPermission) {
        respondToPermission(false, false);
      } else if (isProcessing) {
        interrupt();
      }
    }
  });

  const allMessages = [...messages, ...localMessages];

  return (
    <Box flexDirection="column" width="100%" minHeight={20}>
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

      {/* Workspace selector overlay */}
      {isOpen('workspaceSelector') && (
        <WorkspaceSelector
          workspaces={getWorkspaces()}
          currentWorkspaceId={workspace.id}
          onSelect={workspaceHandlers.handleWorkspaceSelect}
          onCancel={workspaceHandlers.handleWorkspaceCancel}
          onAdd={workspaceHandlers.handleWorkspaceAddOpen}
          onRename={workspaceHandlers.handleWorkspaceRenameOpen}
          onRemove={workspaceHandlers.handleWorkspaceRemove}
        />
      )}

      {/* Workspace add wizard */}
      {isOpen('workspaceAdd') && (
        <WorkspaceAdd
          onComplete={workspaceHandlers.handleWorkspaceAddComplete}
          onCancel={workspaceHandlers.handleWorkspaceAddCancel}
          onErrorAction={handleErrorAction}
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
          onAction={settingsHandlers.handleSettingsAction}
          onCancel={settingsHandlers.handleSettingsCancel}
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

      {/* Agent review */}
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

        {/* AskUserQuestion prompt */}
        {pendingQuestion && (
          <Box marginBottom={1}>
            <AskUserQuestion
              questions={pendingQuestion.questions}
              onSubmit={respondToQuestion}
            />
          </Box>
        )}

        {!hasOpenModal && !pendingPermission && !pendingQuestion && !pendingMcpAuth && !pendingApiAuth && !pendingReview && (
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
          inputTokens={tokenUsage.inputTokens}
          outputTokens={tokenUsage.outputTokens}
          costUsd={tokenUsage.costUsd}
          authType={getAuthType()}
          activeAgentName={activeAgentName ?? undefined}
          agentsLoading={agentsLoading}
          tokenDisplay={tokenDisplayMode}
          showCost={showCostSetting}
          version={getCurrentVersion()}
        />
      </Box>
    </Box>
  );
};
