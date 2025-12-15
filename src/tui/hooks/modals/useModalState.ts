import { useState, useCallback } from 'react';

/**
 * Modal names for the session container.
 * Using a union type ensures type safety when opening modals.
 */
export type ModalName =
  | 'modelSelector'
  | 'help'
  | 'agentMenu'
  | 'workspaceSelector'
  | 'workspaceAdd'
  | 'workspaceRename'
  | 'apiKeyChange'
  | 'claudeMaxAuth'
  | 'balance'
  | 'settings'
  | 'logoutConfirm';

export interface UseModalStateResult {
  /** Currently active modal, or null if none */
  activeModal: ModalName | null;
  /** Open a specific modal (closes any currently open modal) */
  openModal: (name: ModalName) => void;
  /** Close the currently open modal */
  closeModal: () => void;
  /** Check if a specific modal is open */
  isOpen: (name: ModalName) => boolean;
  /** Check if any modal is open */
  hasOpenModal: boolean;
}

/**
 * Consolidates modal state management into a single hook.
 *
 * Benefits:
 * - Single state variable instead of 11 separate useState calls
 * - Prevents multiple modals from being open simultaneously
 * - Type-safe modal names
 * - Cleaner render conditions
 *
 * Usage:
 * ```tsx
 * const { activeModal, openModal, closeModal, isOpen, hasOpenModal } = useModalState();
 *
 * // Open a modal
 * openModal('modelSelector');
 *
 * // Close current modal
 * closeModal();
 *
 * // Check if specific modal is open
 * if (isOpen('help')) { ... }
 *
 * // In render - show input only when no modal is open
 * {!hasOpenModal && <Input ... />}
 * ```
 */
export function useModalState(): UseModalStateResult {
  const [activeModal, setActiveModal] = useState<ModalName | null>(null);

  const openModal = useCallback((name: ModalName) => {
    setActiveModal(name);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  const isOpen = useCallback((name: ModalName) => {
    return activeModal === name;
  }, [activeModal]);

  return {
    activeModal,
    openModal,
    closeModal,
    isOpen,
    hasOpenModal: activeModal !== null,
  };
}
