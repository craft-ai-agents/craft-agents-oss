import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { CraftOAuth, getMcpBaseUrl } from '../../auth/oauth.ts';
import { saveServerCredentialsAsync } from '../../agents/cache.ts';
import type { McpServerConfig } from '../../agents/types.ts';
import { AnimatedSpinner } from './Spinner.tsx';
import { debug } from '../utils/debug.ts';
import { TextInput } from './TextInput.tsx';
import { validateMcpConnection, getValidationErrorMessage } from '../../mcp/validation.ts';
import { getCredentialManager } from '../../credentials/index.ts';

export interface McpAuthProps {
  servers: McpServerConfig[];
  workspaceId: string;
  agentId: string;
  onComplete: (success: boolean) => void;
  onCancel: () => void;
}

type AuthStep = 'confirm' | 'authenticating' | 'validating' | 'bearer-token' | 'complete' | 'error';

export const McpAuth: React.FC<McpAuthProps> = ({
  servers,
  workspaceId,
  agentId,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<AuthStep>('confirm');
  const [currentServerIndex, setCurrentServerIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [completedServers, setCompletedServers] = useState<string[]>([]);
  const [skippedServers, setSkippedServers] = useState<string[]>([]);
  const [bearerToken, setBearerToken] = useState('');
  const [failureReason, setFailureReason] = useState<'oauth' | 'bearer' | 'schema-error' | null>(null);
  const oauthRef = useRef<CraftOAuth | null>(null);
  const isCancelledRef = useRef(false);

  debug('[McpAuth] Mounted with', servers.length, 'servers:', servers.map(s => s.name));

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debug('[McpAuth] Unmounting, cancelling any pending OAuth');
      isCancelledRef.current = true;
      if (oauthRef.current) {
        oauthRef.current.cancel();
      }
    };
  }, []);

  const currentServer = servers[currentServerIndex];

  // Handle keyboard input (for steps without TextInput)
  useInput((input, key) => {
    // Skip escape/ctrl+c handling for bearer-token step (TextInput handles it)
    if (step !== 'bearer-token' && (key.escape || (key.ctrl && input === 'c'))) {
      debug('[McpAuth] User cancelled auth flow');
      isCancelledRef.current = true;
      if (oauthRef.current) {
        oauthRef.current.cancel();
      }
      onCancel();
      return;
    }

    // Enter to start auth when in confirm step
    if (key.return && step === 'confirm') {
      debug('[McpAuth] User confirmed, starting auth for:', currentServer?.name);
      startAuthForCurrentServer();
    }

    // 's' to skip when in confirm or error step
    if (input === 's' && (step === 'confirm' || step === 'error')) {
      skipCurrentServer();
    }

    // Tab to skip when in bearer-token step (can't use 's' as TextInput captures it)
    if (key.tab && step === 'bearer-token') {
      skipCurrentServer();
    }
  });

  // Validate a no-auth (public) server
  const validateNoAuthServer = useCallback(async (server: McpServerConfig): Promise<boolean | 'validation-failed' | 'schema-error'> => {
    if (isCancelledRef.current) return false;

    debug('[McpAuth] Testing connection to no-auth server:', server.name);
    setStatus(`Testing connection to ${server.name}...`);

    try {
      // Get Claude credentials for validation
      const manager = getCredentialManager();
      const claudeApiKey = await manager.getApiKey();
      const claudeOAuthToken = await manager.getClaudeOAuth();

      const validationResult = await validateMcpConnection({
        mcpUrl: server.url,
        // No mcpAccessToken for public servers
        claudeApiKey: claudeApiKey || undefined,
        claudeOAuthToken: claudeOAuthToken || undefined,
      });

      if (!validationResult.success) {
        debug('[McpAuth] No-auth validation failed for', server.name, ':', validationResult.error);
        setError(`${server.name}: ${getValidationErrorMessage(validationResult)}`);
        // Check if this is a schema error (can't be fixed with bearer token)
        if (validationResult.errorType === 'invalid-schema') {
          return 'schema-error' as const;
        }
        // For connection errors, we can try bearer token as fallback
        setFailureReason('oauth');
        return 'validation-failed' as const;
      }

      debug('[McpAuth] No-auth server validated successfully:', server.name);
      return true;
    } catch (err) {
      if (isCancelledRef.current) return false;
      const message = err instanceof Error ? err.message : 'Validation failed';
      debug('[McpAuth] Validation error for', server.name, ':', message);
      setError(`${server.name}: ${message}`);
      setFailureReason('oauth');
      return 'validation-failed' as const;
    }
  }, []);

  const authenticateServer = useCallback(async (server: McpServerConfig): Promise<boolean | 'oauth-failed'> => {
    if (isCancelledRef.current) return false;

    debug('[McpAuth] Starting auth for server:', server.name, 'url:', server.url);
    setStatus(`Connecting to ${server.name}...`);

    try {
      const mcpBaseUrl = getMcpBaseUrl(server.url);
      debug('[McpAuth] MCP base URL:', mcpBaseUrl);

      const oauth = new CraftOAuth(
        { mcpBaseUrl },
        {
          onStatus: (message) => {
            debug('[McpAuth] OAuth status:', message);
            if (!isCancelledRef.current) {
              setStatus(message);
            }
          },
          onError: (err) => {
            debug('[McpAuth] OAuth error:', err);
            if (!isCancelledRef.current) {
              setError(err);
            }
          },
        }
      );

      oauthRef.current = oauth;

      debug('[McpAuth] Calling oauth.authenticate()...');
      const { tokens, clientId } = await oauth.authenticate();
      debug('[McpAuth] Auth successful, got tokens. clientId:', clientId, 'expiresAt:', tokens.expiresAt);

      if (isCancelledRef.current) return false;

      // Validate the MCP connection before saving credentials
      setStep('validating');
      setStatus(`Validating connection to ${server.name}...`);

      // Get Claude credentials for validation
      const manager = getCredentialManager();
      const claudeApiKey = await manager.getApiKey();
      const claudeOAuthToken = await manager.getClaudeOAuth();

      const validationResult = await validateMcpConnection({
        mcpUrl: server.url,
        mcpAccessToken: tokens.accessToken,
        claudeApiKey: claudeApiKey || undefined,
        claudeOAuthToken: claudeOAuthToken || undefined,
      });

      if (!validationResult.success) {
        debug('[McpAuth] Validation failed for', server.name, ':', validationResult.error);
        setError(`${server.name}: ${getValidationErrorMessage(validationResult)}`);
        setFailureReason('oauth');
        oauthRef.current = null;
        return 'oauth-failed' as const;
      }

      // Validation passed - save credentials including clientId for future token refresh (to keychain)
      debug('[McpAuth] Saving credentials for', server.name, 'clientId:', clientId);
      await saveServerCredentialsAsync(workspaceId, agentId, server.name, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        clientId,
      });
      debug('[McpAuth] Credentials saved to keychain for', server.name);

      oauthRef.current = null;
      return true;
    } catch (err) {
      if (isCancelledRef.current) return false;
      const message = err instanceof Error ? err.message : 'Authentication failed';
      debug('[McpAuth] OAuth failed for', server.name, ':', message, '- offering bearer token fallback');
      setError(`${server.name}: ${message}`);
      setFailureReason('oauth');
      oauthRef.current = null;
      // Return 'oauth-failed' to indicate we should offer bearer token as fallback
      return 'oauth-failed' as const;
    }
  }, [workspaceId, agentId]);

  const startAuthForCurrentServer = useCallback(async () => {
    if (servers.length === 0) {
      debug('[McpAuth] No servers to authenticate');
      onComplete(true);
      return;
    }

    const server = servers[currentServerIndex];
    if (!server) return;

    debug('[McpAuth] Processing server', currentServerIndex + 1, 'of', servers.length, ':', server.name, 'requiresAuth:', server.requiresAuth);
    setError(null);

    // Check if this is a no-auth (public) server - validate directly without auth
    if (!server.requiresAuth && !server.bearerToken) {
      debug('[McpAuth] No-auth server detected, validating directly');
      setStep('validating');

      const result = await validateNoAuthServer(server);

      if (isCancelledRef.current) return;

      if (result === 'schema-error') {
        // Schema validation error - can't be fixed with bearer token, must skip or fix server
        debug('[McpAuth] Schema validation error, cannot continue');
        setFailureReason('schema-error');
        setStep('error');
        return;
      }

      if (result === 'validation-failed') {
        // Connection validation failed - offer bearer token as fallback (maybe it needs auth after all)
        debug('[McpAuth] Validation failed, offering bearer token fallback');
        setBearerToken('');
        setStep('bearer-token');
        return;
      }

      if (!result) {
        debug('[McpAuth] Server validation failed');
        setStep('error');
        return;
      }

      // Validation passed
      setCompletedServers((prev) => [...prev, server.name]);

      // Move to next server or complete
      const nextIndex = currentServerIndex + 1;
      if (nextIndex < servers.length) {
        setCurrentServerIndex(nextIndex);
        setStep('confirm');
        setStatus('');
      } else {
        setStep('complete');
        setStatus('All servers validated');
        setTimeout(() => {
          if (!isCancelledRef.current) {
            onComplete(true);
          }
        }, 1000);
      }
      return;
    }

    // Regular auth flow for servers that require authentication
    setStep('authenticating');

    const result = await authenticateServer(server);

    if (isCancelledRef.current) return;

    if (result === 'oauth-failed') {
      // OAuth failed - offer bearer token as fallback
      debug('[McpAuth] OAuth failed, offering bearer token fallback');
      setBearerToken('');
      setStep('bearer-token');
      return;
    }

    if (!result) {
      debug('[McpAuth] Server auth failed');
      setStep('error');
      return;
    }

    debug('[McpAuth] Server', server.name, 'authenticated successfully');
    setCompletedServers((prev) => [...prev, server.name]);

    // Check if there are more servers
    const nextIndex = currentServerIndex + 1;
    if (nextIndex < servers.length) {
      // Move to next server, show confirm step
      setCurrentServerIndex(nextIndex);
      setStep('confirm');
      setStatus('');
    } else {
      // All done
      debug('[McpAuth] All servers authenticated successfully');
      setStep('complete');
      setStatus('All servers authenticated');

      // Small delay to show success before closing
      setTimeout(() => {
        if (!isCancelledRef.current) {
          debug('[McpAuth] Completing auth flow');
          onComplete(true);
        }
      }, 1000);
    }
  }, [servers, currentServerIndex, authenticateServer, validateNoAuthServer, onComplete]);

  // Handle bearer token submission
  const handleBearerTokenSubmit = useCallback(async (token: string) => {
    if (!token.trim()) return;

    const server = servers[currentServerIndex];
    if (!server) return;

    debug('[McpAuth] Validating bearer token for', server.name);

    // Validate the connection before saving
    setStep('validating');
    setStatus(`Validating connection to ${server.name}...`);

    // Get Claude credentials for validation
    const manager = getCredentialManager();
    const claudeApiKey = await manager.getApiKey();
    const claudeOAuthToken = await manager.getClaudeOAuth();

    const validationResult = await validateMcpConnection({
      mcpUrl: server.url,
      mcpAccessToken: token.trim(),
      claudeApiKey: claudeApiKey || undefined,
      claudeOAuthToken: claudeOAuthToken || undefined,
    });

    if (!validationResult.success) {
      debug('[McpAuth] Bearer token validation failed for', server.name, ':', validationResult.error);
      setError(`${server.name}: ${getValidationErrorMessage(validationResult)}`);
      setFailureReason('bearer');
      setStep('bearer-token'); // Go back to token entry
      return;
    }

    debug('[McpAuth] Saving bearer token for', server.name);

    // Validation passed - save token as non-expiring access token (to keychain)
    await saveServerCredentialsAsync(workspaceId, agentId, server.name, {
      accessToken: token.trim(),
      // No refreshToken, no expiresAt - static bearer token
    });

    setCompletedServers((prev) => [...prev, server.name]);

    // Check if there are more servers
    const nextIndex = currentServerIndex + 1;
    if (nextIndex < servers.length) {
      setCurrentServerIndex(nextIndex);
      setStep('confirm');
      setBearerToken('');
      setError(null);
      setStatus('');
    } else {
      // All done
      debug('[McpAuth] All servers authenticated successfully');
      setStep('complete');
      setStatus('All servers authenticated');

      setTimeout(() => {
        if (!isCancelledRef.current) {
          onComplete(true);
        }
      }, 1000);
    }
  }, [servers, currentServerIndex, workspaceId, agentId, onComplete]);

  // Skip current server without authentication
  const skipCurrentServer = useCallback(() => {
    const server = servers[currentServerIndex];
    if (!server) return;

    debug('[McpAuth] Skipping server:', server.name);
    setSkippedServers(prev => [...prev, server.name]);

    const nextIndex = currentServerIndex + 1;
    if (nextIndex < servers.length) {
      setCurrentServerIndex(nextIndex);
      setStep('confirm');
      setBearerToken('');
      setError(null);
      setFailureReason(null);
      setStatus('');
    } else {
      // All done
      debug('[McpAuth] Authentication complete (some servers skipped)');
      setStep('complete');
      setStatus('Authentication complete (some servers skipped)');

      setTimeout(() => {
        if (!isCancelledRef.current) {
          onComplete(true);
        }
      }, 1000);
    }
  }, [servers, currentServerIndex, onComplete]);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>MCP Server Setup</Text>
        {servers.length > 1 && (
          <Text dimColor> - {currentServerIndex + 1} of {servers.length}</Text>
        )}
      </Box>

      {/* Server list */}
      <Box flexDirection="column" marginBottom={1}>
        {servers.map((server, i) => (
          <Box key={server.url}>
            <Text>
              {skippedServers.includes(server.name) ? (
                <Text dimColor>⊘ </Text>
              ) : completedServers.includes(server.name) ? (
                <Text color="green">✓ </Text>
              ) : i === currentServerIndex && (step === 'authenticating' || step === 'validating') ? (
                <Text color="yellow">● </Text>
              ) : i === currentServerIndex && (step === 'confirm' || step === 'bearer-token') ? (
                <Text color="cyan">→ </Text>
              ) : (
                <Text dimColor>○ </Text>
              )}
              <Text dimColor={i > currentServerIndex && !completedServers.includes(server.name) && !skippedServers.includes(server.name)}>
                {server.name}
                {skippedServers.includes(server.name) && <Text dimColor> (skipped)</Text>}
              </Text>
            </Text>
          </Box>
        ))}
      </Box>

      {/* Confirm step - waiting for user to press Enter */}
      {step === 'confirm' && currentServer && (
        <Box marginY={1} flexDirection="column">
          <Text>
            Ready to {currentServer.requiresAuth ? 'authenticate with' : 'test connection to'} <Text bold color="cyan">{currentServer.name}</Text>
          </Text>
          {currentServer.requiresAuth && (
            <Text dimColor>This will open your browser for authorization.</Text>
          )}
        </Box>
      )}

      {/* Authenticating step */}
      {step === 'authenticating' && (
        <Box marginY={1}>
          <AnimatedSpinner />
          <Text> {status}</Text>
        </Box>
      )}

      {/* Validating step */}
      {step === 'validating' && (
        <Box marginY={1}>
          <AnimatedSpinner />
          <Text> {status}</Text>
        </Box>
      )}

      {/* Complete step */}
      {step === 'complete' && (
        <Box marginY={1}>
          <Text color="green">✓ {status}</Text>
        </Box>
      )}

      {/* Bearer token step - fallback when OAuth fails */}
      {step === 'bearer-token' && currentServer && (
        <Box marginY={1} flexDirection="column">
          <Text color="yellow">
            {failureReason === 'bearer'
              ? `Token validation failed for ${currentServer.name}`
              : currentServer.requiresAuth
              ? `OAuth authentication failed for ${currentServer.name}`
              : `Validation failed for ${currentServer.name}`}
          </Text>
          {error && <Text dimColor>{error}</Text>}
          <Box marginTop={1} flexDirection="column">
            <Text>Enter a bearer token instead:</Text>
            <Box marginTop={1}>
              <Text color="green">&gt; </Text>
              <TextInput
                value={bearerToken}
                onChange={setBearerToken}
                onSubmit={handleBearerTokenSubmit}
                onCancel={onCancel}
                placeholder="Paste your bearer token..."
                mask="•"
                maskReveal={{ last: 4 }}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Error step */}
      {step === 'error' && currentServer && (
        <Box marginY={1} flexDirection="column">
          <Text color="red">✗ {failureReason === 'schema-error' ? 'Validation failed' : 'Authentication failed'}</Text>
          {error && <Text color="red">{error}</Text>}
          {failureReason === 'schema-error' && (
            <Box marginTop={1}>
              <Text dimColor>This server has schema validation errors that cannot be fixed with authentication. Use an alternative server instead.</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Instructions */}
      <Box marginTop={1}>
        {step === 'confirm' && (
          <Text dimColor>Press Enter to continue, s to skip, Esc to cancel</Text>
        )}
        {step === 'authenticating' && (
          <Text dimColor>Complete authorization in your browser. Press Esc to cancel.</Text>
        )}
        {step === 'bearer-token' && (
          <Text dimColor>Press Enter to submit, Tab to skip, Esc to cancel</Text>
        )}
        {step === 'error' && (
          <Text dimColor>Press Esc to cancel</Text>
        )}
      </Box>
    </Box>
  );
};
