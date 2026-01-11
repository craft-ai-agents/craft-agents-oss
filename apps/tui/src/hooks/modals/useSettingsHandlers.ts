import { useCallback, useState } from 'react';
import type { SettingsAction } from '../../components/Settings.tsx';
import type { ModalName } from './useModalState.ts';
import type { Message } from '../../components/Messages.tsx';
import type { AuthType, TokenDisplayMode } from '@craft-agent/shared/config';
import {
  updateApiKey,
  setAuthType,
  setTokenDisplay,
  setShowCost,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { setAuthEnvironment } from '@craft-agent/shared/auth/env';
import { maskCredential } from '@craft-agent/shared/utils/mask';

/**
 * State for pending auth mode switch (when credentials exist)
 */
export interface PendingAuthModeSwitch {
  authType: 'api_key' | 'oauth_token';
  maskedCredential: string;
}

/**
 * Props for useSettingsHandlers hook
 */
export interface UseSettingsHandlersProps {
  closeModal: () => void;
  openModal: (name: ModalName) => void;
  setCompactMode: (compact: boolean) => void;
  setTokenDisplayMode: (mode: TokenDisplayMode) => void;
  setShowCostSetting: (show: boolean) => void;
  setShowClockSetting: (show: boolean) => void;
  setSafeModeSetting: (enabled: boolean) => void;
  addMessage: (content: string, type: Message['type']) => void;
  /** Reset the CraftAgent instance (for hot-switching auth) */
  resetAgentInstance: () => void;
  /** Whether the agent is currently processing a message */
  isProcessing: boolean;
}

/**
 * Result of useSettingsHandlers hook
 */
export interface UseSettingsHandlersResult {
  // API Key modal handlers
  handleApiKeySubmit: (apiKey: string) => Promise<void>;
  handleApiKeyCancel: () => void;
  // Claude Max modal handlers
  handleClaudeMaxSubmit: (token: string) => Promise<void>;
  handleClaudeMaxCancel: () => void;
  // Craft Credits modal handlers
  handleCraftCreditsSubmit: (token: string) => Promise<void>;
  handleCraftCreditsCancel: () => void;
  // Settings menu handlers
  handleSettingsAction: (action: SettingsAction) => Promise<void>;
  handleSettingsCancel: () => void;
  // Auth mode options modal state and handlers
  pendingAuthSwitch: PendingAuthModeSwitch | null;
  handleAuthModeUseExisting: () => void;
  handleAuthModeReauthenticate: () => void;
  handleAuthModeCancel: () => void;
}

/**
 * Hook that handles all settings and auth-related callbacks.
 *
 * Extracts ~90 lines of settings handling logic from SessionContainer.
 * Groups related callbacks for API key, Claude Max, and settings menu.
 *
 * Usage:
 * ```tsx
 * const settingsHandlers = useSettingsHandlers({
 *   closeModal,
 *   openModal,
 *   setCompactMode,
 *   setTokenDisplayMode,
 *   setShowCostSetting,
 *   addMessage,
 * });
 *
 * // In components
 * <ApiKeyChange onSubmit={settingsHandlers.handleApiKeySubmit} onCancel={settingsHandlers.handleApiKeyCancel} />
 * <Settings onAction={settingsHandlers.handleSettingsAction} onCancel={settingsHandlers.handleSettingsCancel} />
 * ```
 */
export function useSettingsHandlers(props: UseSettingsHandlersProps): UseSettingsHandlersResult {
  const {
    closeModal,
    openModal,
    setCompactMode,
    setTokenDisplayMode,
    setShowCostSetting,
    setShowClockSetting,
    setSafeModeSetting,
    addMessage,
    resetAgentInstance,
    isProcessing,
  } = props;

  // State for pending auth mode switch
  const [pendingAuthSwitch, setPendingAuthSwitch] = useState<PendingAuthModeSwitch | null>(null);

  // API Key handlers
  const handleApiKeySubmit = useCallback(async (newApiKey: string) => {
    // Block if processing a message
    if (isProcessing) {
      addMessage('Cannot switch auth while processing. Please wait for the current request to complete.', 'warning');
      return;
    }

    closeModal();
    try {
      const success = await updateApiKey(newApiKey);
      if (success) {
        // Hot-switch: update env vars and reset agent
        setAuthEnvironment({ type: 'api_key', credentials: { apiKey: newApiKey } });
        resetAgentInstance();
        addMessage('API key saved. Your next message will use the new credentials.', 'info');
      } else {
        addMessage('Failed to update API key.', 'error');
      }
    } catch {
      addMessage('Failed to update API key.', 'error');
    }
  }, [closeModal, addMessage, isProcessing, resetAgentInstance]);

  const handleApiKeyCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Claude Max handlers
  const handleClaudeMaxSubmit = useCallback(async (token: string) => {
    // Block if processing a message
    if (isProcessing) {
      addMessage('Cannot switch auth while processing. Please wait for the current request to complete.', 'warning');
      return;
    }

    closeModal();
    try {
      const manager = getCredentialManager();
      await manager.setClaudeOAuth(token);
      setAuthType('oauth_token');
      // Hot-switch: update env vars and reset agent
      setAuthEnvironment({ type: 'oauth_token', credentials: { oauthToken: token } });
      resetAgentInstance();
      addMessage('Claude Max token saved. Your next message will use the new credentials.', 'info');
    } catch {
      addMessage('Failed to save Claude Max token.', 'error');
    }
  }, [closeModal, addMessage, isProcessing, resetAgentInstance]);

  const handleClaudeMaxCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Craft Credits handlers
  const handleCraftCreditsSubmit = useCallback(async (token: string) => {
    // Block if processing a message
    if (isProcessing) {
      addMessage('Cannot switch auth while processing. Please wait for the current request to complete.', 'warning');
      return;
    }

    closeModal();
    try {
      setAuthType('craft_credits');
      // Hot-switch: update env vars for Craft Credits
      setAuthEnvironment({ type: 'craft_credits', credentials: { gatewayToken: token } });
      resetAgentInstance();
      addMessage('Craft Credits authentication saved. Your next message will use the new credentials.', 'info');
    } catch {
      addMessage('Failed to save Craft credentials.', 'error');
    }
  }, [closeModal, addMessage, isProcessing, resetAgentInstance]);

  const handleCraftCreditsCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Settings menu handlers
  const handleSettingsAction = useCallback(async (action: SettingsAction) => {
    switch (action.type) {
      case 'set_verbose':
        setCompactMode(!action.verbose);
        break;
      case 'set_token_display':
        setTokenDisplay(action.mode);
        setTokenDisplayMode(action.mode);
        break;
      case 'set_show_cost':
        setShowCost(action.show);
        setShowCostSetting(action.show);
        break;
      case 'set_show_clock':
        // setShowClock config removed - just update local state
        setShowClockSetting(action.show);
        break;
      case 'set_safe_mode':
        // setSafeMode config removed - just update local state
        setSafeModeSetting(action.enabled);
        addMessage(`Safe Mode ${action.enabled ? 'enabled' : 'disabled'}`, 'info');
        break;
      case 'change_auth_mode': {
        // Block if processing a message
        if (isProcessing) {
          addMessage('Cannot switch auth while processing. Please wait for the current request to complete.', 'warning');
          return;
        }

        closeModal();

        if (action.mode === 'craft_credits') {
          // Go directly to CraftCreditsAuth - it handles browser OAuth
          openModal('craftCreditsAuth');
          return;
        }

        if (action.mode === 'api_key') {
          const manager = getCredentialManager();
          const existingKey = await manager.getApiKey();
          if (existingKey) {
            // Show options modal instead of auto-selecting
            setPendingAuthSwitch({
              authType: 'api_key',
              maskedCredential: maskCredential(existingKey, { type: 'api_key' }),
            });
            openModal('authModeOptions');
          } else {
            openModal('apiKeyChange');
          }
          return;
        }

        if (action.mode === 'oauth_token') {
          // Go directly to ClaudeMaxAuth - it handles both "use existing" and "run setup"
          openModal('claudeMaxAuth');
          return;
        }
        break;
      }
    }
  }, [closeModal, openModal, setCompactMode, setTokenDisplayMode, setShowCostSetting, setShowClockSetting, setSafeModeSetting, addMessage, isProcessing, resetAgentInstance]);

  const handleSettingsCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Auth mode options modal handlers
  const handleAuthModeUseExisting = useCallback(async () => {
    if (!pendingAuthSwitch) return;

    // Block if processing a message
    if (isProcessing) {
      addMessage('Cannot switch auth while processing. Please wait for the current request to complete.', 'warning');
      return;
    }

    closeModal();
    const authType = pendingAuthSwitch.authType;
    setPendingAuthSwitch(null);

    // Update config
    setAuthType(authType);

    // Get the credential and update env vars for hot-switching
    const manager = getCredentialManager();
    if (authType === 'api_key') {
      const apiKey = await manager.getApiKey();
      if (apiKey) {
        setAuthEnvironment({ type: 'api_key', credentials: { apiKey } });
      }
    } else if (authType === 'oauth_token') {
      const oauthToken = await manager.getClaudeOAuth();
      if (oauthToken) {
        setAuthEnvironment({ type: 'oauth_token', credentials: { oauthToken } });
      }
    }

    // Reset the agent instance so the next message uses new credentials
    resetAgentInstance();

    const label = authType === 'api_key' ? 'API Key' : 'Claude Max';
    addMessage(
      `Switched to ${label}. Your next message will use the new credentials.`,
      'info'
    );
  }, [pendingAuthSwitch, isProcessing, closeModal, addMessage, resetAgentInstance]);

  const handleAuthModeReauthenticate = useCallback(() => {
    if (!pendingAuthSwitch) return;

    closeModal();
    const authType = pendingAuthSwitch.authType;
    setPendingAuthSwitch(null);

    // Open the appropriate auth modal
    if (authType === 'api_key') {
      openModal('apiKeyChange');
    } else {
      openModal('claudeMaxAuth');
    }
  }, [pendingAuthSwitch, closeModal, openModal]);

  const handleAuthModeCancel = useCallback(() => {
    closeModal();
    setPendingAuthSwitch(null);
  }, [closeModal]);

  return {
    handleApiKeySubmit,
    handleApiKeyCancel,
    handleClaudeMaxSubmit,
    handleClaudeMaxCancel,
    handleCraftCreditsSubmit,
    handleCraftCreditsCancel,
    handleSettingsAction,
    handleSettingsCancel,
    pendingAuthSwitch,
    handleAuthModeUseExisting,
    handleAuthModeReauthenticate,
    handleAuthModeCancel,
  };
}
