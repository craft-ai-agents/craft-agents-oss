// apps/electron/src/renderer/hooks/useTemplates.ts

import { useAtom } from 'jotai';
import { templatesAtom, loadTemplatesAtom } from '@/atoms/templates';
import { useEffect } from 'react';

export function useTemplates(workspaceId: string) {
  const [templates] = useAtom(templatesAtom);
  const [, loadTemplates] = useAtom(loadTemplatesAtom);

  useEffect(() => {
    loadTemplates({ scope: 'all', workspaceId });
  }, [workspaceId, loadTemplates]);

  return {
    templates: templates.items,
    isLoading: templates.isLoading,
    error: templates.error,
  };
}
