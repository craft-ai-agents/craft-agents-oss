import React, { useCallback, useMemo } from 'react';
import { GlobalProvider } from './context/GlobalContext.tsx';
import { SessionContainer } from './components/SessionContainer.tsx';
import { loadStoredConfig, saveConfig, getOrCreateLatestSession, createSession, getOrCreateSessionById, type Session } from '@craft-agent/shared/config';
import { DEFAULT_MODEL } from '@craft-agent/shared/config';
import type { CraftAgentConfig } from '@craft-agent/shared/agent';
import { debug } from '@craft-agent/shared/utils';

export interface AppProps {
  config: CraftAgentConfig;
  onRequestSetup?: () => void;
  /** Agent to auto-activate on startup (without @ prefix) */
  initialAgent?: string;
  /** Prompt to auto-send after agent activation (or immediately if no agent) */
  initialPrompt?: string;
  /** Error message to display on startup (e.g., workspace not found) */
  initialError?: string;
  /** Start a new session (--new flag) */
  newSession?: boolean;
  /** Resume specific session by ID (--session flag) */
  sessionId?: string;
}

/**
 * App is the root component that provides global state and session-based isolation.
 *
 * Architecture (Session-Based Scoping):
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  App (Global State: model, workspace, session)                      │
 * │  ┌───────────────────────────────────────────────────────────────┐  │
 * │  │  SessionContainer key={session.id}                            │  │
 * │  │  ┌─────────────────────────────────────────────────────────┐  │  │
 * │  │  │  ALL session-scoped state lives here                   │  │  │
 * │  │  │  • messages, tokenUsage, streamingText                 │  │  │
 * │  │  │  • pendingPermission, pendingQuestion                  │  │  │
 * │  │  │  • CraftAgent instance (1:1 with session)              │  │  │
 * │  │  │  • All refs reset automatically                        │  │  │
 * │  │  └─────────────────────────────────────────────────────────┘  │  │
 * │  └───────────────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * When session.id changes (workspace switch, /clear, --new):
 * 1. React unmounts SessionContainer (cleanup runs)
 * 2. ALL useState, useRef, useEffect cleanup automatically
 * 3. React mounts NEW SessionContainer
 * 4. Fresh hooks initialize, effects run
 * 5. New session's conversation loads
 *
 * Session is the primary isolation boundary - workspace is just infrastructure.
 */
export const App: React.FC<AppProps> = ({
  config,
  onRequestSetup,
  initialAgent,
  initialPrompt,
  initialError,
  newSession,
  sessionId,
}) => {
  // Handle model changes - persist to storage
  const handleModelChange = useCallback((model: string) => {
    const storedConfig = loadStoredConfig();
    if (storedConfig) {
      storedConfig.model = model;
      saveConfig(storedConfig);
    }
  }, []);

  // Resolve initial session based on CLI flags:
  // --new → create new session
  // --session <id> → load specific session (fallback to new if not found)
  // (default) → resume latest session for workspace
  const initialSession = useMemo((): Session => {
    let session: Session;
    if (newSession) {
      // --new: Create a fresh session
      session = createSession(config.workspace.id);
      debug('[App] Created new session (--new):', session.id);
    } else if (sessionId) {
      // --session <id>: Get or create session with this ID
      session = getOrCreateSessionById(sessionId, config.workspace.id);
      debug('[App] Using session (--session):', session.id, 'SDK session:', session.sdkSessionId || 'none');
    } else {
      // Default: Resume latest session for workspace
      session = getOrCreateLatestSession(config.workspace.id);
      debug('[App] Resuming latest session:', session.id, 'SDK session:', session.sdkSessionId || 'none');
    }
    return session;
  }, [config.workspace.id, newSession, sessionId]);

  return (
    <GlobalProvider
      initialModel={config.model || DEFAULT_MODEL}
      initialWorkspace={config.workspace}
      initialSession={initialSession}
      onModelChange={handleModelChange}
    >
      <SessionContainerWithKey
        config={config}
        onRequestSetup={onRequestSetup}
        initialAgent={initialAgent}
        initialPrompt={initialPrompt}
        initialError={initialError}
      />
    </GlobalProvider>
  );
};

/**
 * Wrapper component that renders SessionContainer with key={session.id}.
 * This must be inside GlobalProvider to access session from context.
 */
import { useGlobalContext } from './context/GlobalContext.tsx';

interface SessionContainerWithKeyProps {
  config: CraftAgentConfig;
  onRequestSetup?: () => void;
  initialAgent?: string;
  initialPrompt?: string;
  initialError?: string;
}

const SessionContainerWithKey: React.FC<SessionContainerWithKeyProps> = ({
  config,
  onRequestSetup,
  initialAgent,
  initialPrompt,
  initialError,
}) => {
  const { workspace, model, session } = useGlobalContext();

  // Create a modified config with current workspace, model, and session from global context
  const currentConfig: CraftAgentConfig = {
    ...config,
    workspace,
    model,
  };

  return (
    <SessionContainer
      key={session.id}  // THE MAGIC: Session change = full remount = fresh state
      config={currentConfig}
      session={session}
      onRequestSetup={onRequestSetup}
      initialAgent={initialAgent}
      initialPrompt={initialPrompt}
      initialError={initialError}
    />
  );
};
