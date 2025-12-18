import { useCallback } from 'react';
import type { SettingsAction } from '../../components/Settings.tsx';
import type { ModalName } from './useModalState.ts';
import type { Message } from '../../components/Messages.tsx';
import type { TokenDisplayMode } from '@craft-agent/shared/config';
import {
  updateApiKey,
  setAuthType,
  setTokenDisplay,
  setShowCost,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';

/**
 * Props for useSettingsHandlers hook
 */
export interface UseSettingsHandlersProps {
  closeModal: () => void;
  openModal: (name: ModalName) => void;
  setCompactMode: (compact: boolean) => void;
  setTokenDisplayMode: (mode: TokenDisplayMode) => void;
  setShowCostSetting: (show: boolean) => void;
  addMessage: (content: string, type: Message['type']) => void;
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
  // Settings menu handlers
  handleSettingsAction: (action: SettingsAction) => Promise<void>;
  handleSettingsCancel: () => void;
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
    addMessage,
  } = props;

  // API Key handlers
  const handleApiKeySubmit = useCallback(async (newApiKey: string) => {
    closeModal();
    try {
      const success = await updateApiKey(newApiKey);
      if (success) {
        addMessage('API key saved. Please exit (Ctrl+C) and restart the app for changes to take effect.', 'warning');
      } else {
        addMessage('Failed to update API key.', 'error');
      }
    } catch {
      addMessage('Failed to update API key.', 'error');
    }
  }, [closeModal, addMessage]);

  const handleApiKeyCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Claude Max handlers
  const handleClaudeMaxSubmit = useCallback(async (token: string) => {
    closeModal();
    try {
      const manager = getCredentialManager();
      await manager.setClaudeOAuth(token);
      setAuthType('oauth_token');
      addMessage('Claude Max token saved. Please exit (Ctrl+C) and restart the app for changes to take effect.', 'warning');
    } catch {
      addMessage('Failed to save Claude Max token.', 'error');
    }
  }, [closeModal, addMessage]);

  const handleClaudeMaxCancel = useCallback(() => {
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
      case 'change_auth_mode': {
        closeModal();

        if (action.mode === 'craft_credits') {
          setAuthType('craft_credits');
          addMessage(
            'Switched to Craft Credits. Please exit (Ctrl+C) and restart the app for changes to take effect.',
            'warning'
          );
          return;
        }

        if (action.mode === 'api_key') {
          const manager = getCredentialManager();
          const existingKey = await manager.getApiKey();
          if (existingKey) {
            setAuthType('api_key');
            addMessage(
              'Switched to API Key. Please exit (Ctrl+C) and restart the app for changes to take effect.',
              'warning'
            );
          } else {
            openModal('apiKeyChange');
          }
          return;
        }

        if (action.mode === 'oauth_token') {
          const manager = getCredentialManager();
          const existingToken = await manager.getClaudeOAuth();
          if (existingToken) {
            setAuthType('oauth_token');
            addMessage(
              'Switched to Claude Max. Please exit (Ctrl+C) and restart the app for changes to take effect.',
              'warning'
            );
          } else {
            openModal('claudeMaxAuth');
          }
          return;
        }
        break;
      }
    }
  }, [closeModal, openModal, setCompactMode, setTokenDisplayMode, setShowCostSetting, addMessage]);

  const handleSettingsCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  return {
    handleApiKeySubmit,
    handleApiKeyCancel,
    handleClaudeMaxSubmit,
    handleClaudeMaxCancel,
    handleSettingsAction,
    handleSettingsCancel,
  };
}
