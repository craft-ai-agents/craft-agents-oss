// apps/electron/src/renderer/atoms/templates.ts

import { atom } from 'jotai';
import type { SessionTemplate } from '@vesper/shared/templates';
import type { CreateSessionOptions } from '../../shared/types';

interface TemplatesState {
  items: SessionTemplate[];
  isLoading: boolean;
  error: string | null;
}

// Base atom for template state
export const templatesAtom = atom<TemplatesState>({
  items: [],
  isLoading: false,
  error: null,
});

// Atom to load templates
export const loadTemplatesAtom = atom(
  null,
  async (get, set, { scope, workspaceId }: { scope: 'global' | 'workspace' | 'all'; workspaceId?: string }) => {
    set(templatesAtom, { items: [], isLoading: true, error: null });
    try {
      const templates = await window.electron.invoke('template:list', scope, workspaceId);
      set(templatesAtom, { items: templates, isLoading: false, error: null });
    } catch (error) {
      set(templatesAtom, {
        items: [],
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load templates',
      });
    }
  }
);

// Atom to create a template
export const createTemplateAtom = atom(
  null,
  async (get, set, options: Parameters<typeof window.electron.invoke>[1]) => {
    const template = await window.electron.invoke('template:create', options);
    const current = get(templatesAtom);
    set(templatesAtom, {
      ...current,
      items: [...current.items, template],
    });
    return template;
  }
);

// Atom to update a template
export const updateTemplateAtom = atom(
  null,
  async (
    get,
    set,
    {
      id,
      scope,
      workspaceId,
      updates,
    }: {
      id: string;
      scope: 'global' | 'workspace';
      workspaceId?: string;
      updates: Partial<SessionTemplate>;
    }
  ) => {
    const updated = await window.electron.invoke('template:update', id, scope, workspaceId, updates);
    const current = get(templatesAtom);
    set(templatesAtom, {
      ...current,
      items: current.items.map(t => (t.id === id ? updated : t)),
    });
    return updated;
  }
);

// Atom to delete a template
export const deleteTemplateAtom = atom(
  null,
  async (get, set, { id, scope, workspaceId }: { id: string; scope: 'global' | 'workspace'; workspaceId?: string }) => {
    await window.electron.invoke('template:delete', id, scope, workspaceId);
    const current = get(templatesAtom);
    set(templatesAtom, {
      ...current,
      items: current.items.filter(t => t.id !== id),
    });
  }
);

// Atom to use a template (increments usage count and returns template)
export const useTemplateAtom = atom(
  null,
  async (get, set, { id, scope, workspaceId }: { id: string; scope: 'global' | 'workspace'; workspaceId?: string }) => {
    const template = await window.electron.invoke('template:use', id, scope, workspaceId);
    const current = get(templatesAtom);
    set(templatesAtom, {
      ...current,
      items: current.items.map(t => (t.id === id ? template : t)),
    });
    return template;
  }
);

// Atom to control template picker dialog state
interface TemplatePickerState {
  isOpen: boolean;
  workspaceId: string | null;
  onSelectCallback: ((template: SessionTemplate | null, initialPrompt?: string) => void) | null;
}

export const templatePickerAtom = atom<TemplatePickerState>({
  isOpen: false,
  workspaceId: null,
  onSelectCallback: null,
});

// Atom to show template picker
export const showTemplatePickerAtom = atom(
  null,
  (
    get,
    set,
    {
      workspaceId,
      onSelect,
    }: {
      workspaceId: string;
      onSelect: (template: SessionTemplate | null, initialPrompt?: string) => void;
    }
  ) => {
    set(templatePickerAtom, {
      isOpen: true,
      workspaceId,
      onSelectCallback: onSelect,
    });
  }
);

// Atom to hide template picker
export const hideTemplatePickerAtom = atom(null, (get, set) => {
  set(templatePickerAtom, {
    isOpen: false,
    workspaceId: null,
    onSelectCallback: null,
  });
});
