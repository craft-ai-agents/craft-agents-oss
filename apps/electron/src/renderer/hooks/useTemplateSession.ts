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

      // Start with template configuration, then merge baseOptions (baseOptions override template)
      const options: CreateSessionOptions = {
        permissionMode: template.permissionMode,
        workingDirectory: template.workingDirectory,
        model: template.model,
        thinkingLevel: template.thinkingLevel,
        skillIds: template.skillIds,
        // Merge with baseOptions (baseOptions override template)
        ...baseOptions,
      };

      // NOTE: skillIds will be passed to SessionManager.createSession which currently
      // doesn't handle skill attachment. Skills need to be attached post-creation via
      // the skills system. This is handled at the UI integration level when wiring
      // TemplatePickerDialog to the session creation flow.

      return options;
    },
    []
  );

  return { createSessionFromTemplate };
}
