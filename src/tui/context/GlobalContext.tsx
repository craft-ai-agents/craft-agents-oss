import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { Workspace, CumulativeUsage, Session } from '../../config/storage.ts';
import {
  getCumulativeUsage,
  addToCumulativeUsage,
  createSession,
  setActiveSession,
  switchWorkspaceAtomic,
} from '../../config/storage.ts';

/**
 * GlobalContext holds state that PERSISTS across session switches.
 *
 * Architecture (Session-Based Scoping):
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  GLOBAL (this context)                                              │
 * │  • model, workspace, session, cumulativeUsage                       │
 * │  • Persists across session switches                                 │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  WORKSPACE (infrastructure)                                         │
 * │  • MCP server URL + credentials                                     │
 * │  • Does NOT trigger remount on change (just updates config)         │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  SESSION (state isolation boundary) ← key={session.id}              │
 * │  • SDK session ID, conversation, token usage                        │
 * │  • Changing session.id triggers SessionContainer remount            │
 * │  • CraftAgent instance = 1:1 with session                           │
 * └─────────────────────────────────────────────────────────────────────┘
 */

export interface GlobalContextValue {
  // Current AI model (persists across session switches)
  model: string;
  setModel: (model: string) => void;

  // Current workspace (infrastructure - MCP connection)
  // Changing workspace auto-loads/creates a session for that workspace
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;

  // Current session (primary isolation boundary)
  // Changing session triggers SessionContainer remount via key={session.id}
  session: Session;
  setSession: (session: Session) => void;

  // Start a new session in the current workspace (e.g., /clear command)
  startNewSession: () => Session;

  // Global cumulative usage across all sessions
  cumulativeUsage: CumulativeUsage;
  addUsage: (delta: { costUsd: number; inputTokens: number; outputTokens: number }) => void;
}

const GlobalContext = createContext<GlobalContextValue | null>(null);

export interface GlobalProviderProps {
  children: React.ReactNode;
  initialModel: string;
  initialWorkspace: Workspace;
  initialSession: Session;
  onModelChange?: (model: string) => void;
}

export function GlobalProvider({
  children,
  initialModel,
  initialWorkspace,
  initialSession,
  onModelChange,
}: GlobalProviderProps) {
  const [model, setModelState] = useState(initialModel);
  const [workspace, setWorkspaceState] = useState(initialWorkspace);
  const [session, setSessionState] = useState(initialSession);
  const [cumulativeUsage, setCumulativeUsage] = useState<CumulativeUsage>(() => getCumulativeUsage());

  const setModel = useCallback((newModel: string) => {
    setModelState(newModel);
    onModelChange?.(newModel);
  }, [onModelChange]);

  const setSession = useCallback((newSession: Session) => {
    // Persist active session to storage
    setActiveSession(newSession.id);
    // Update state (triggers SessionContainer remount via key)
    setSessionState(newSession);
  }, []);

  const setWorkspace = useCallback((newWorkspace: Workspace) => {
    // Use atomic switch to update workspace + session in single config write
    // This prevents race conditions if process crashes mid-switch
    const result = switchWorkspaceAtomic(newWorkspace.id);
    if (!result) {
      // Workspace not found - this shouldn't happen, but update state anyway
      setWorkspaceState(newWorkspace);
      return;
    }

    // Update React state (triggers SessionContainer remount via key={session.id})
    setWorkspaceState(result.workspace);
    setSessionState(result.session);
  }, []);

  const startNewSession = useCallback(() => {
    // Create a new session in the current workspace
    // Note: createSession() already saves config with activeSessionId
    const newSession = createSession(workspace.id);
    // Update state (triggers SessionContainer remount via key)
    setSessionState(newSession);
    return newSession;
  }, [workspace.id]);

  const addUsage = useCallback((delta: { costUsd: number; inputTokens: number; outputTokens: number }) => {
    // Only add if there's actual new usage
    if (delta.costUsd > 0 || delta.inputTokens > 0 || delta.outputTokens > 0) {
      const updated = addToCumulativeUsage(delta);
      setCumulativeUsage(updated);
    }
  }, []);

  // Memoize context value to prevent unnecessary re-renders of consumers
  // when unrelated state in GlobalProvider changes
  const contextValue = useMemo<GlobalContextValue>(() => ({
    model,
    setModel,
    workspace,
    setWorkspace,
    session,
    setSession,
    startNewSession,
    cumulativeUsage,
    addUsage,
  }), [model, setModel, workspace, setWorkspace, session, setSession, startNewSession, cumulativeUsage, addUsage]);

  return (
    <GlobalContext.Provider value={contextValue}>
      {children}
    </GlobalContext.Provider>
  );
}

export function useGlobalContext(): GlobalContextValue {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useGlobalContext must be used within GlobalProvider');
  }
  return context;
}
