import { useCallback } from 'react';
import {
  getWorkspaces,
  removeWorkspace,
  renameWorkspace,
  type Workspace,
} from '../../../config/storage.ts';
import type { ModalName } from './useModalState.ts';
import type { Message } from '../../components/Messages.tsx';

/**
 * Props for useWorkspaceHandlers hook
 */
export interface UseWorkspaceHandlersProps {
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  openModal: (name: ModalName) => void;
  closeModal: () => void;
  addMessage: (content: string, type: Message['type']) => void;
}

/**
 * Result of useWorkspaceHandlers hook
 */
export interface UseWorkspaceHandlersResult {
  /** Handle workspace selection from selector */
  handleWorkspaceSelect: (workspaceId: string) => void;
  /** Cancel workspace selector */
  handleWorkspaceCancel: () => void;
  /** Open workspace add wizard */
  handleWorkspaceAddOpen: () => void;
  /** Open workspace rename dialog */
  handleWorkspaceRenameOpen: (workspaceId: string) => void;
  /** Remove a workspace */
  handleWorkspaceRemove: (workspaceId: string) => Promise<void>;
  /** Handle workspace add completion */
  handleWorkspaceAddComplete: (newWorkspace: Workspace) => void;
  /** Cancel workspace add */
  handleWorkspaceAddCancel: () => void;
  /** Handle workspace rename submission */
  handleWorkspaceRenameSubmit: (newName: string) => void;
  /** Cancel workspace rename */
  handleWorkspaceRenameCancel: () => void;
}

/**
 * Hook that handles all workspace-related operations.
 *
 * Extracts ~80 lines of workspace handling logic from SessionContainer.
 *
 * Usage:
 * ```tsx
 * const workspaceHandlers = useWorkspaceHandlers({
 *   workspace,
 *   setWorkspace,
 *   openModal,
 *   closeModal,
 *   addMessage,
 * });
 *
 * // In WorkspaceSelector
 * <WorkspaceSelector
 *   onSelect={workspaceHandlers.handleWorkspaceSelect}
 *   onCancel={workspaceHandlers.handleWorkspaceCancel}
 *   onAdd={workspaceHandlers.handleWorkspaceAddOpen}
 *   onRename={workspaceHandlers.handleWorkspaceRenameOpen}
 *   onRemove={workspaceHandlers.handleWorkspaceRemove}
 * />
 * ```
 */
export function useWorkspaceHandlers(props: UseWorkspaceHandlersProps): UseWorkspaceHandlersResult {
  const { workspace, setWorkspace, openModal, closeModal, addMessage } = props;

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    closeModal();
    const workspaces = getWorkspaces();
    const selectedWorkspace = workspaces.find(w => w.id === workspaceId);
    if (selectedWorkspace) {
      setWorkspace(selectedWorkspace);
    }
  }, [setWorkspace, closeModal]);

  const handleWorkspaceCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const handleWorkspaceAddOpen = useCallback(() => {
    closeModal();
    openModal('workspaceAdd');
  }, [openModal, closeModal]);

  const handleWorkspaceRenameOpen = useCallback((workspaceId: string) => {
    closeModal();
    if (workspaceId !== workspace.id) {
      const workspaces = getWorkspaces();
      const targetWorkspace = workspaces.find(w => w.id === workspaceId);
      if (targetWorkspace) {
        setWorkspace(targetWorkspace);
      }
    }
    openModal('workspaceRename');
  }, [workspace.id, setWorkspace, openModal, closeModal]);

  const handleWorkspaceRemove = useCallback(async (workspaceId: string) => {
    closeModal();
    const workspaces = getWorkspaces();

    if (workspaces.length === 1) {
      addMessage('Cannot remove the only workspace. Add another workspace first.', 'error');
      return;
    }

    const workspaceToRemove = workspaces.find(w => w.id === workspaceId);
    if (!workspaceToRemove) {
      addMessage('Workspace not found.', 'error');
      return;
    }

    const isActive = workspaceId === workspace.id;
    const removed = await removeWorkspace(workspaceId);

    if (removed) {
      addMessage(`Workspace "${workspaceToRemove.name}" removed.`, 'system');
      if (isActive) {
        const remainingWorkspaces = getWorkspaces();
        if (remainingWorkspaces.length > 0 && remainingWorkspaces[0]) {
          setWorkspace(remainingWorkspaces[0]);
        }
      }
    } else {
      addMessage('Failed to remove workspace.', 'error');
    }
  }, [workspace.id, setWorkspace, addMessage, closeModal]);

  const handleWorkspaceAddComplete = useCallback((newWorkspace: Workspace) => {
    closeModal();
    setWorkspace(newWorkspace);
  }, [setWorkspace, closeModal]);

  const handleWorkspaceAddCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const handleWorkspaceRenameSubmit = useCallback((newName: string) => {
    closeModal();
    const success = renameWorkspace(workspace.id, newName);
    if (success) {
      setWorkspace({ ...workspace, name: newName });
    }
  }, [workspace, setWorkspace, closeModal]);

  const handleWorkspaceRenameCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  return {
    handleWorkspaceSelect,
    handleWorkspaceCancel,
    handleWorkspaceAddOpen,
    handleWorkspaceRenameOpen,
    handleWorkspaceRemove,
    handleWorkspaceAddComplete,
    handleWorkspaceAddCancel,
    handleWorkspaceRenameSubmit,
    handleWorkspaceRenameCancel,
  };
}
