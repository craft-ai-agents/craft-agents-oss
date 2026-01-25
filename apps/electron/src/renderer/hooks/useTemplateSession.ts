// apps/electron/src/renderer/hooks/useTemplateSession.ts

import { useCallback } from 'react';
import type { SessionTemplate } from '@vesper/shared/templates';
import type { CreateSessionOptions } from '../../shared/types';

/**
 * Hook to create a session from a template
 */
export function useTemplateSession() {
  const createSessionFromTemplate = useCallback(
    async (template: SessionTemplate | null, baseOptions?: CreateSessionOptions): Promise<CreateSessionOptions> => {
      if (!template) {
        // No template, use base options or empty
        return baseOptions ?? {};
      }

      // Merge template configuration with base options (base options take precedence)
      const options: CreateSessionOptions = {
        permissionMode: baseOptions?.permissionMode ?? template.permissionMode,
        workingDirectory: baseOptions?.workingDirectory ?? template.workingDirectory,
        ...baseOptions,
      };

      return options;
    },
    []
  );

  return { createSessionFromTemplate };
}
