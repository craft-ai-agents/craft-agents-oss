import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { saveApiKeyCredentialAsync } from '../../../../src/agents/cache.ts';
import type { ApiConfig } from '../../../../src/agents/types.ts';
import { debug } from '../../../../src/utils/debug.ts';
import { TextInput } from './TextInput.tsx';

export interface ApiAuthProps {
  apis: ApiConfig[];
  workspaceId: string;
  agentId: string;
  onComplete: (success: boolean) => void;
  onCancel: () => void;
}

/**
 * Component for collecting API credentials during agent setup.
 * Handles different auth types:
 * - none: Skipped entirely (no prompt)
 * - basic: Two-step input (username, then password)
 * - header/bearer/query: Single API key input
 */
export const ApiAuth: React.FC<ApiAuthProps> = ({
  apis,
  workspaceId,
  agentId,
  onComplete,
  onCancel,
}) => {
  // Filter out 'none' auth type - they don't need credentials
  const apisNeedingAuth = useMemo(
    () => apis.filter(api => api.auth && api.auth.type !== 'none'),
    [apis]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [completedApis, setCompletedApis] = useState<string[]>([]);

  // For basic auth: track if we're on username or password step
  const [basicAuthUsername, setBasicAuthUsername] = useState('');
  const [isPasswordStep, setIsPasswordStep] = useState(false);

  debug('[ApiAuth] Mounted with', apis.length, 'APIs,', apisNeedingAuth.length, 'need auth');

  const currentApi = apisNeedingAuth[currentIndex];
  const isBasicAuth = currentApi?.auth?.type === 'basic';

  // Move to next API or complete
  const moveToNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < apisNeedingAuth.length) {
      setCurrentIndex(nextIndex);
      setInputValue('');
      setBasicAuthUsername('');
      setIsPasswordStep(false);
    } else {
      debug('[ApiAuth] All APIs configured, completing');
      onComplete(true);
    }
  }, [currentIndex, apisNeedingAuth.length, onComplete]);

  // Handle input submission
  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim()) return;

    const api = apisNeedingAuth[currentIndex];
    if (!api) return;

    // Handle basic auth two-step flow
    if (isBasicAuth) {
      if (!isPasswordStep) {
        // First step: save username and move to password
        debug('[ApiAuth] Basic auth: saved username for', api.name);
        setBasicAuthUsername(value.trim());
        setInputValue('');
        setIsPasswordStep(true);
        return;
      }

      // Second step: combine username + password and save as JSON
      const credential = JSON.stringify({
        username: basicAuthUsername,
        password: value.trim(),
      });
      debug('[ApiAuth] Saving basic auth credential for', api.name);
      await saveApiKeyCredentialAsync(workspaceId, agentId, api.name, credential);
    } else {
      // Standard API key flow
      debug('[ApiAuth] Saving API key for', api.name);
      await saveApiKeyCredentialAsync(workspaceId, agentId, api.name, value.trim());
    }

    setCompletedApis(prev => [...prev, api.name]);
    moveToNext();
  }, [apisNeedingAuth, currentIndex, workspaceId, agentId, isBasicAuth, isPasswordStep, basicAuthUsername, moveToNext]);

  // Build helpful auth hint
  const getAuthHint = (api: ApiConfig): string => {
    if (!api.auth) return '';
    switch (api.auth.type) {
      case 'none':
        return '(no auth required)';
      case 'header':
        return `(${api.auth.headerName || 'x-api-key'} header)`;
      case 'bearer': {
        const scheme = api.auth.authScheme || 'Bearer';
        return scheme === 'Bearer' ? '(Bearer token)' : `(${scheme} token)`;
      }
      case 'query':
        return `(?${api.auth.queryParam || 'api_key'} param)`;
      case 'basic':
        return '(HTTP Basic Auth)';
      default:
        return '';
    }
  };

  // Get credential label from auth config or use defaults
  const getCredentialLabel = (): string => {
    if (!currentApi?.auth) return 'API key';
    return currentApi.auth.credentialLabel || 'API key';
  };

  const getSecretLabel = (): string => {
    if (!currentApi?.auth) return 'password';
    return currentApi.auth.secretLabel || 'password';
  };

  // Get prompt text based on auth type and step
  const getPromptText = (): React.ReactNode => {
    if (!currentApi) return null;

    if (isBasicAuth) {
      if (isPasswordStep) {
        const secretLabel = getSecretLabel();
        return (
          <>Enter {secretLabel} for <Text bold color="cyan">{currentApi.name}</Text></>
        );
      }
      const credLabel = getCredentialLabel();
      return (
        <>Enter {credLabel} for <Text bold color="cyan">{currentApi.name}</Text></>
      );
    }

    const credLabel = getCredentialLabel();
    return (
      <>Enter {credLabel} for <Text bold color="cyan">{currentApi.name}</Text></>
    );
  };

  // Get placeholder text
  const getPlaceholder = (): string => {
    if (isBasicAuth) {
      if (isPasswordStep) {
        const secretLabel = getSecretLabel();
        return `Enter ${secretLabel}...`;
      }
      const credLabel = getCredentialLabel();
      return `Enter ${credLabel}...`;
    }
    const credLabel = getCredentialLabel();
    return `Paste your ${credLabel}...`;
  };

  // Handle cancel - for basic auth, go back to username if on password step
  const handleCancel = useCallback(() => {
    if (isBasicAuth && isPasswordStep) {
      // Go back to username step
      setInputValue(basicAuthUsername);
      setIsPasswordStep(false);
      return;
    }
    onCancel();
  }, [isBasicAuth, isPasswordStep, basicAuthUsername, onCancel]);

  // If no APIs need auth, complete immediately
  if (apisNeedingAuth.length === 0) {
    // Use effect would be cleaner but this works for immediate completion
    React.useEffect(() => {
      debug('[ApiAuth] No APIs need auth, completing immediately');
      onComplete(true);
    }, [onComplete]);
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>API Credentials Required</Text>
        {apisNeedingAuth.length > 1 && (
          <Text dimColor> - {currentIndex + 1} of {apisNeedingAuth.length}</Text>
        )}
      </Box>

      {/* API list */}
      <Box flexDirection="column" marginBottom={1}>
        {apisNeedingAuth.map((api, i) => (
          <Box key={api.name}>
            <Text>
              {completedApis.includes(api.name) ? (
                <Text color="green">✓ </Text>
              ) : i === currentIndex ? (
                <Text color="cyan">→ </Text>
              ) : (
                <Text dimColor>○ </Text>
              )}
              <Text dimColor={i > currentIndex && !completedApis.includes(api.name)}>
                {api.name}
              </Text>
              <Text dimColor> {getAuthHint(api)}</Text>
            </Text>
          </Box>
        ))}
      </Box>

      {/* Input prompt */}
      {currentApi && (
        <Box marginY={1} flexDirection="column">
          <Text>
            {getPromptText()}
            {!isBasicAuth && currentApi.auth && <Text dimColor> {getAuthHint(currentApi)}</Text>}
          </Text>
          <Box marginTop={1}>
            <Text color="green">&gt; </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              placeholder={getPlaceholder()}
              mask={isBasicAuth && isPasswordStep ? '•' : undefined}
              maskReveal={isBasicAuth && isPasswordStep ? { last: 4 } : undefined}
            />
          </Box>
        </Box>
      )}

      {/* Instructions */}
      <Box marginTop={1}>
        <Text dimColor>
          {isBasicAuth && isPasswordStep
            ? 'Press Enter to continue, Esc to go back'
            : 'Press Enter to continue, Esc to skip'
          }
        </Text>
      </Box>
    </Box>
  );
};
