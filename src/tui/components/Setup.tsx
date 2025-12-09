import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { saveConfig, getConfigPath, generateWorkspaceId, loadStoredConfig, getActiveWorkspace, type StoredConfig, type Workspace, type AuthType } from '../../config/storage.ts';
import { CraftOAuth, getMcpBaseUrl } from '../../auth/oauth.ts';
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '../../auth/claude-token.ts';
import { getCredentialManager } from '../../credentials/index.ts';
import { validateMcpConnection, getValidationErrorMessage } from '../../mcp/validation.ts';
import { TextInput } from './TextInput.tsx';
import { AnimatedSpinner } from './Spinner.tsx';
import { McpUrlTypeStep, type McpUrlMethod } from './McpUrlTypeStep.tsx';
import { CraftAuth } from './craftAuth/CraftAuth.tsx';

type SetupStep = 'welcome' | 'auth-type' | 'api-key' | 'oauth-token' | 'oauth-token-setup' | 'mcp-url-type' | 'mcp-url' | 'craft-auth' | 'checking-auth' | 'no-oauth-options' | 'oauth-auth' | 'bearer-token' | 'confirm' | 'complete' | 'error' | 'validating';

export interface SetupProps {
  onComplete: (config: StoredConfig) => void;
  onCancel: () => void;
}

export const Setup: React.FC<SetupProps> = ({ onComplete, onCancel }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<SetupStep>('welcome');
  const [authType, setAuthType] = useState<AuthType>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [oauthStatus, setOauthStatus] = useState('');

  // Track if we have existing MCP config to skip those steps
  const [hasExistingMcp, setHasExistingMcp] = useState(false);
  const [existingWorkspace, setExistingWorkspace] = useState<Workspace | null>(null);

  // Load existing config on mount
  useEffect(() => {
    const loadExisting = async () => {
      const existingConfig = loadStoredConfig();
      const activeWorkspace = getActiveWorkspace();
      if (existingConfig && activeWorkspace && activeWorkspace.mcpUrl) {
        setHasExistingMcp(true);
        setExistingWorkspace(activeWorkspace);
        setMcpUrl(activeWorkspace.mcpUrl);
        setIsPublicServer(activeWorkspace.isPublic ?? false);

        // Load OAuth from keychain
        const manager = getCredentialManager();
        const oauth = await manager.getWorkspaceOAuth(activeWorkspace.id);
        if (oauth) {
          setOauthResult({
            accessToken: oauth.accessToken,
            refreshToken: oauth.refreshToken,
            expiresAt: oauth.expiresAt,
            clientId: oauth.clientId || '',
            tokenType: oauth.tokenType || 'Bearer',
          });
        }
      }
    };
    loadExisting();
  }, []);
  const [oauthResult, setOauthResult] = useState<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    clientId: string;
    tokenType: string;
  } | null>(null);
  const [isPublicServer, setIsPublicServer] = useState(false);
  const [mcpBearerToken, setMcpBearerToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showOauthToken, setShowOauthToken] = useState(false);
  const [oauthClient, setOauthClient] = useState<CraftOAuth | null>(null);
  const [hasClaudeCli, setHasClaudeCli] = useState(false);
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null);
  const [isRunningSetupToken, setIsRunningSetupToken] = useState(false);

  // Check for Claude CLI and existing token on mount
  useEffect(() => {
    setHasClaudeCli(isClaudeCliInstalled());
    setExistingClaudeToken(getExistingClaudeToken());
  }, []);

  // Handle Ctrl+C to cancel
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (step === 'welcome') {
        exit();
      } else {
        // Cancel OAuth flow if in progress
        if (oauthClient) {
          oauthClient.cancel();
          setOauthClient(null);
        }
        onCancel();
      }
    }

    // Toggle visibility for sensitive fields
    if (key.ctrl && input === 'v') {
      if (step === 'api-key') setShowApiKey(!showApiKey);
      if (step === 'oauth-token') setShowOauthToken(!showOauthToken);
    }

    // Handle validation step retry/back
    if (step === 'validating' && validationError) {
      if (key.return) {
        // Retry validation
        handleConfirm();
      } else if (key.escape) {
        // Go back to confirm step
        setValidationError(null);
        setStep('confirm');
      }
    }
  });

  const handleWelcome = useCallback(() => {
    setStep('auth-type');
  }, []);

  const handleAuthTypeSelect = useCallback((type: AuthType) => {
    setAuthType(type);
    if (type === 'api_key') {
      setStep('api-key');
    } else {
      // Check for existing Claude token
      const existing = getExistingClaudeToken();
      if (existing) {
        setExistingClaudeToken(existing);
      }
      setStep('oauth-token');
    }
  }, []);

  const handleOauthToken = useCallback((value: string) => {
    if (!value.trim()) return;
    setOauthToken(value.trim());
    // Skip MCP setup if we have existing config
    if (hasExistingMcp) {
      setStep('confirm');
    } else {
      setStep('mcp-url-type');
    }
  }, [hasExistingMcp]);

  const handleUseExistingToken = useCallback(() => {
    if (existingClaudeToken) {
      setOauthToken(existingClaudeToken);
      if (hasExistingMcp) {
        setStep('confirm');
      } else {
        setStep('mcp-url-type');
      }
    }
  }, [existingClaudeToken, hasExistingMcp]);

  const handleRunSetupToken = useCallback(async () => {
    setStep('oauth-token-setup');
    setIsRunningSetupToken(true);

    const result = await runClaudeSetupToken((status) => {
      setOauthStatus(status);
    });

    setIsRunningSetupToken(false);

    if (result.success && result.token) {
      setOauthToken(result.token);
      setExistingClaudeToken(result.token);
      if (hasExistingMcp) {
        setStep('confirm');
      } else {
        setStep('mcp-url-type');
      }
    } else {
      setError(result.error || 'Failed to get token');
      setStep('oauth-token');
    }
  }, [hasExistingMcp]);

  const handleApiKey = useCallback((value: string) => {
    if (!value.trim()) return;
    setApiKey(value.trim());
    // Skip MCP setup if we have existing config
    if (hasExistingMcp) {
      setStep('confirm');
    } else {
      setStep('mcp-url-type');
    }
  }, [hasExistingMcp]);

  const handleMcpUrlTypeSelect = useCallback((method: McpUrlMethod) => {
    if (method === 'paste') {
      setStep('mcp-url');
    } else {
      setStep('craft-auth');
    }
  }, []);

  const handleCraftAuthComplete = useCallback((url: string) => {
    setMcpUrl(url);
    setIsPublicServer(true);
    setStep('confirm');
  }, []);

  const handleMcpUrl = useCallback((value: string) => {
    if (!value.trim()) return;

    // Basic URL validation
    try {
      new URL(value.trim());
      setMcpUrl(value.trim());
      setStep('checking-auth');
    } catch {
      setError('Please enter a valid URL');
    }
  }, []);

  const handleNoOAuthSelect = useCallback((method: 'bearer' | 'public') => {
    if (method === 'bearer') {
      setStep('bearer-token');
    } else {
      setIsPublicServer(true);
      setStep('confirm');
    }
  }, []);

  const handleMcpBearerToken = useCallback((token: string) => {
    if (!token.trim()) return;
    setMcpBearerToken(token.trim());
    setStep('confirm');
  }, []);

  // Check if OAuth is required when entering checking-auth step
  useEffect(() => {
    if (step !== 'checking-auth' || !mcpUrl) return;

    const mcpBaseUrl = getMcpBaseUrl(mcpUrl);
    const oauth = new CraftOAuth(
      { mcpBaseUrl },
      {
        onStatus: (message) => setOauthStatus(message),
        onError: () => {},
      }
    );

    setOauthStatus('Checking server authentication requirements...');

    oauth.checkAuthRequired()
      .then((authRequired) => {
        if (authRequired) {
          setIsPublicServer(false);
          setStep('oauth-auth');
        } else {
          // No OAuth detected - offer bearer token or public options
          setStep('no-oauth-options');
        }
      })
      .catch(() => {
        // Can't detect OAuth - offer alternatives
        setStep('no-oauth-options');
      });
  }, [step, mcpUrl]);

  // Start OAuth flow when entering oauth-auth step
  useEffect(() => {
    if (step !== 'oauth-auth' || !mcpUrl) return;

    const mcpBaseUrl = getMcpBaseUrl(mcpUrl);
    const oauth = new CraftOAuth(
      { mcpBaseUrl },
      {
        onStatus: (message) => setOauthStatus(message),
        onError: (errorMsg) => {
          setError(errorMsg);
          setStep('error');
        },
      }
    );

    setOauthClient(oauth);

    oauth.authenticate()
      .then(({ tokens, clientId }) => {
        setOauthResult({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          clientId,
          tokenType: tokens.tokenType,
        });
        setOauthClient(null);
        setStep('confirm');
      })
      .catch((err) => {
        // OAuth failed - offer bearer token as alternative
        setOauthStatus(err instanceof Error ? err.message : 'OAuth failed');
        setOauthClient(null);
        setStep('no-oauth-options');
      });

    return () => {
      oauth.cancel();
    };
  }, [step, mcpUrl]);

  const handleConfirm = useCallback(async () => {
    // For new MCP setup, we need OAuth, bearer token, or public
    if (!hasExistingMcp && !isPublicServer && !oauthResult && !mcpBearerToken) {
      setError('MCP authentication not completed');
      setStep('error');
      return;
    }

    setStep('validating');
    setValidationError(null);

    try {
      // Determine MCP access token for validation
      let mcpAccessToken: string | undefined;
      if (oauthResult) {
        mcpAccessToken = oauthResult.accessToken;
      } else if (mcpBearerToken) {
        mcpAccessToken = mcpBearerToken;
      }
      // For public servers, no token needed

      // Validate MCP connection using SDK
      const validationResult = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken,
        claudeApiKey: authType === 'api_key' ? apiKey : undefined,
        claudeOAuthToken: authType === 'oauth_token' ? oauthToken : undefined,
      });

      if (!validationResult.success) {
        setValidationError(getValidationErrorMessage(validationResult));
        return; // Stay on validating step with error
      }

      // Validation passed - save credentials to keychain
      const manager = getCredentialManager();

      // Save Claude credentials to keychain
      if (authType === 'api_key' && apiKey) {
        await manager.setApiKey(apiKey);
      } else if (authType === 'oauth_token' && oauthToken) {
        await manager.setClaudeOAuth(oauthToken);
      }

      // Reuse existing workspace or create new one
      let workspace: Workspace;
      let workspaceId: string;

      if (hasExistingMcp && existingWorkspace) {
        // Reuse existing workspace (just updating auth)
        workspace = existingWorkspace;
        workspaceId = existingWorkspace.id;
      } else {
        // Create new workspace from MCP URL
        workspaceId = generateWorkspaceId();
        workspace = {
          id: workspaceId,
          name: 'Default',
          mcpUrl: mcpUrl,
          isPublic: isPublicServer,
          createdAt: Date.now(),
        };
      }

      // Save workspace credentials to keychain (not in config)
      if (oauthResult) {
        await manager.setWorkspaceOAuth(workspaceId, {
          accessToken: oauthResult.accessToken,
          refreshToken: oauthResult.refreshToken,
          expiresAt: oauthResult.expiresAt,
          clientId: oauthResult.clientId,
          tokenType: oauthResult.tokenType,
        });
      } else if (mcpBearerToken) {
        await manager.setWorkspaceBearer(workspaceId, mcpBearerToken);
      }

      // Load existing config to preserve other workspaces
      const existingConfig = loadStoredConfig();
      const existingWorkspaces = existingConfig?.workspaces || [];

      // Update or add the workspace
      let updatedWorkspaces: Workspace[];
      if (hasExistingMcp && existingWorkspace) {
        // Keep all existing workspaces as-is (we're just changing Claude auth)
        updatedWorkspaces = existingWorkspaces;
      } else {
        // Add new workspace
        updatedWorkspaces = [...existingWorkspaces.filter(w => w.id !== workspaceId), workspace];
      }

      // Build config (credentials stored in keychain, not here)
      const config: StoredConfig = {
        authType,
        workspaces: updatedWorkspaces,
        activeWorkspaceId: workspaceId,
      };

      saveConfig(config);
      setStep('complete');

      // Give user a moment to see success message
      setTimeout(() => {
        onComplete(config);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      setStep('error');
    }
  }, [apiKey, oauthToken, authType, mcpUrl, oauthResult, isPublicServer, mcpBearerToken, onComplete, hasExistingMcp, existingWorkspace]);

  const handleBack = useCallback(() => {
    setError(null);
    // Cancel any ongoing OAuth flow
    if (oauthClient) {
      oauthClient.cancel();
      setOauthClient(null);
    }
    switch (step) {
      case 'auth-type':
        setStep('welcome');
        break;
      case 'api-key':
      case 'oauth-token':
        setStep('auth-type');
        break;
      case 'mcp-url-type':
        if (authType === 'api_key') {
          setStep('api-key');
        } else {
          setStep('oauth-token');
        }
        break;
      case 'mcp-url':
      case 'craft-auth':
        setStep('mcp-url-type');
        break;
      case 'checking-auth':
      case 'no-oauth-options':
      case 'oauth-auth':
        setStep('mcp-url');
        break;
      case 'bearer-token':
        setStep('no-oauth-options');
        break;
      case 'confirm':
        // If we skipped MCP setup, go back to auth input
        if (hasExistingMcp) {
          if (authType === 'api_key') {
            setStep('api-key');
          } else {
            setStep('oauth-token');
          }
        } else {
          setStep('mcp-url'); // Go back to URL, will re-check auth
          setOauthResult(null);
          setIsPublicServer(false);
          setMcpBearerToken('');
        }
        break;
      case 'error':
        if (hasExistingMcp) {
          setStep('auth-type');
        } else {
          setStep('mcp-url');
          setOauthResult(null);
          setIsPublicServer(false);
        }
        break;
    }
  }, [step, oauthClient, authType, hasExistingMcp]);

  const maskValue = (value: string, show: boolean): string => {
    if (show || !value) return value;
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Text bold color="cyan">Craft TUI Agent - Setup</Text>
      </Box>

      {/* Progress indicator */}
      <Box marginBottom={1}>
        <Text dimColor>
          Step {getStepNumber(step, hasExistingMcp)} of {hasExistingMcp ? 3 : 5}:{' '}
        </Text>
        <Text>{getStepName(step)}</Text>
      </Box>

      {/* Step content */}
      <Box flexDirection="column" marginY={1}>
        {step === 'welcome' && (
          <WelcomeStep onContinue={handleWelcome} hasExistingMcp={hasExistingMcp} />
        )}

        {step === 'auth-type' && (
          <AuthTypeStep
            onSelect={handleAuthTypeSelect}
            onBack={handleBack}
          />
        )}

        {step === 'api-key' && (
          <InputStep
            title="Anthropic API Key"
            description="Enter your Anthropic API key. You can get one from https://console.anthropic.com/"
            placeholder="sk-ant-..."
            value={apiKey}
            masked={!showApiKey}
            onSubmit={handleApiKey}
            onBack={handleBack}
            hint="Press Ctrl+V to toggle visibility"
          />
        )}

        {step === 'oauth-token' && (
          <OAuthTokenStep
            existingToken={existingClaudeToken}
            hasClaudeCli={hasClaudeCli}
            onUseExisting={handleUseExistingToken}
            onRunSetup={handleRunSetupToken}
            onManualEntry={handleOauthToken}
            onBack={handleBack}
            error={error}
          />
        )}

        {step === 'oauth-token-setup' && (
          <Box flexDirection="column">
            <Text bold>Running Claude Setup Token</Text>
            <Box marginY={1}>
              <Text color="cyan">●</Text>
              <Text> {oauthStatus || 'Opening browser for authentication...'}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Complete the authentication in your browser, then return here.</Text>
            </Box>
          </Box>
        )}

        {step === 'mcp-url-type' && (
          <McpUrlTypeStep
            onSelect={handleMcpUrlTypeSelect}
            onBack={handleBack}
          />
        )}

        {step === 'mcp-url' && (
          <InputStep
            title="Craft MCP Server URL"
            description="Enter the URL of your Craft MCP server."
            placeholder="https://mcp.craft.do/links/YOUR_LINK_ID"
            value={mcpUrl}
            onSubmit={handleMcpUrl}
            onBack={handleBack}
            error={error}
          />
        )}

        {step === 'craft-auth' && (
          <CraftAuth
            onComplete={handleCraftAuthComplete}
            onBack={handleBack}
          />
        )}

        {step === 'checking-auth' && (
          <Box flexDirection="column">
            <Text bold>Checking Server</Text>
            <Box marginY={1}>
              <Text color="cyan">●</Text>
              <Text> {oauthStatus || 'Connecting to server...'}</Text>
            </Box>
          </Box>
        )}

        {step === 'no-oauth-options' && (
          <NoOAuthOptionsStep
            onSelect={handleNoOAuthSelect}
            onBack={handleBack}
            message={oauthStatus}
          />
        )}

        {step === 'bearer-token' && (
          <BearerTokenStep
            value={mcpBearerToken}
            onChange={setMcpBearerToken}
            onSubmit={handleMcpBearerToken}
            onBack={handleBack}
          />
        )}

        {step === 'oauth-auth' && (
          <OAuthStep
            status={oauthStatus}
            onBack={handleBack}
          />
        )}

        {step === 'confirm' && (
          <ConfirmStep
            authType={authType}
            apiKey={authType === 'api_key' ? maskValue(apiKey, false) : undefined}
            oauthToken={authType === 'oauth_token' ? maskValue(oauthToken, false) : undefined}
            mcpUrl={mcpUrl}
            isPublic={isPublicServer}
            oauthAuthenticated={!!oauthResult}
            bearerToken={mcpBearerToken ? maskValue(mcpBearerToken, false) : undefined}
            onConfirm={handleConfirm}
            onBack={handleBack}
          />
        )}

        {step === 'validating' && (
          <Box flexDirection="column">
            {validationError ? (
              <>
                <Text color="red" bold>Connection validation failed</Text>
                <Box marginY={1}>
                  <Text color="red">{validationError}</Text>
                </Box>
                <Text dimColor>Press Enter to retry, Esc to go back</Text>
              </>
            ) : (
              <Box>
                <AnimatedSpinner />
                <Text> Validating MCP connection...</Text>
              </Box>
            )}
          </Box>
        )}

        {step === 'complete' && (
          <Box flexDirection="column">
            <Text color="green" bold>✓ Configuration saved successfully!</Text>
            <Text dimColor>Config stored at: {getConfigPath()}</Text>
            <Box marginTop={1}>
              <Text>Starting Craft TUI Agent...</Text>
            </Box>
          </Box>
        )}

        {step === 'error' && (
          <Box flexDirection="column">
            <Text color="red" bold>✗ Setup failed</Text>
            <Text color="red">{error}</Text>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to retry, or Ctrl+C to exit</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          Press Ctrl+C to cancel | Esc to go back
        </Text>
      </Box>
    </Box>
  );
};

function getStepNumber(step: SetupStep, hasExistingMcp: boolean = false): number {
  if (hasExistingMcp) {
    // Shortened flow: welcome/auth-type -> api-key/oauth-token -> confirm
    switch (step) {
      case 'welcome': return 1;
      case 'auth-type': return 1;
      case 'api-key': return 2;
      case 'oauth-token': return 2;
      case 'oauth-token-setup': return 2;
      case 'confirm':
      case 'validating':
      case 'complete':
      case 'error':
        return 3;
      default: return 3;
    }
  }
  // Full flow
  switch (step) {
    case 'welcome': return 1;
    case 'auth-type': return 1;
    case 'api-key': return 2;
    case 'oauth-token': return 2;
    case 'oauth-token-setup': return 2;
    case 'mcp-url-type': return 3;
    case 'mcp-url': return 3;
    case 'craft-auth': return 3;
    case 'checking-auth': return 4;
    case 'no-oauth-options': return 4;
    case 'oauth-auth': return 4;
    case 'bearer-token': return 4;
    case 'confirm':
    case 'validating':
    case 'complete':
    case 'error':
      return 5;
  }
}

function getStepName(step: SetupStep): string {
  switch (step) {
    case 'welcome': return 'Welcome';
    case 'auth-type': return 'Authentication';
    case 'api-key': return 'API Key';
    case 'oauth-token': return 'OAuth Token';
    case 'oauth-token-setup': return 'Setting up...';
    case 'mcp-url-type': return 'MCP Setup';
    case 'mcp-url': return 'MCP URL';
    case 'craft-auth': return 'Craft Auth';
    case 'checking-auth': return 'Checking...';
    case 'no-oauth-options': return 'Auth Method';
    case 'oauth-auth': return 'Authorization';
    case 'bearer-token': return 'Bearer Token';
    case 'confirm': return 'Confirm';
    case 'validating': return 'Validating...';
    case 'complete': return 'Complete';
    case 'error': return 'Error';
  }
}

// Sub-components

interface WelcomeStepProps {
  onContinue: () => void;
  hasExistingMcp?: boolean;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onContinue, hasExistingMcp }) => {
  useInput((input, key) => {
    if (key.return) {
      onContinue();
    }
  });

  if (hasExistingMcp) {
    return (
      <Box flexDirection="column">
        <Text>Welcome to <Text bold color="cyan">Craft TUI Agent</Text> Setup!</Text>
        <Box marginY={1}>
          <Text>
            Your MCP server is already configured. This will update your Claude authentication.
          </Text>
        </Box>
        <Box marginY={1}>
          <Text>You can choose:</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text>• <Text bold>API Key</Text> - Pay-as-you-go billing</Text>
          <Text>• <Text bold>Claude Max Token</Text> - Use your Max subscription</Text>
        </Box>
        <Box marginTop={2}>
          <Text color="green" bold>Press Enter to continue...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Welcome to <Text bold color="cyan">Craft TUI Agent</Text>!</Text>
      <Box marginY={1}>
        <Text>
          This setup will help you configure your connection to Claude and your Craft MCP server.
        </Text>
      </Box>
      <Box marginY={1}>
        <Text>You'll need:</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text>• An Anthropic API key OR Claude Max OAuth token</Text>
        <Text>• Your Craft MCP server URL (workflow link)</Text>
        <Text>• A browser to complete OAuth authorization</Text>
      </Box>
      <Box marginTop={2}>
        <Text color="green" bold>Press Enter to continue...</Text>
      </Box>
    </Box>
  );
};

interface AuthTypeStepProps {
  onSelect: (type: AuthType) => void;
  onBack: () => void;
}

const AuthTypeStep: React.FC<AuthTypeStepProps> = ({ onSelect, onBack }) => {
  const [selected, setSelected] = useState<number>(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(0);
    } else if (key.downArrow) {
      setSelected(1);
    } else if (key.return) {
      onSelect(selected === 0 ? 'api_key' : 'oauth_token');
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Choose Authentication Method</Text>
      <Box marginY={1}>
        <Text dimColor>How would you like to authenticate with Claude?</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text color={selected === 0 ? 'green' : undefined}>
            {selected === 0 ? '❯ ' : '  '}
          </Text>
          <Text color={selected === 0 ? 'green' : undefined} bold={selected === 0}>
            API Key
          </Text>
          <Text dimColor> - Pay-as-you-go billing (console.anthropic.com)</Text>
        </Box>
        <Box>
          <Text color={selected === 1 ? 'green' : undefined}>
            {selected === 1 ? '❯ ' : '  '}
          </Text>
          <Text color={selected === 1 ? 'green' : undefined} bold={selected === 1}>
            Claude Max Token
          </Text>
          <Text dimColor> - Use your Max subscription (run 'claude setup-token')</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to select, Enter to confirm, Esc to go back</Text>
      </Box>
    </Box>
  );
};

interface InputStepProps {
  title: string;
  description: string;
  placeholder: string;
  value: string;
  masked?: boolean;
  onSubmit: (value: string) => void;
  onBack: () => void;
  hint?: string;
  error?: string | null;
}

const InputStep: React.FC<InputStepProps> = ({
  title,
  description,
  placeholder,
  value: initialValue,
  masked = false,
  onSubmit,
  onBack,
  hint,
  error,
}) => {
  const [value, setValue] = useState(initialValue);

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Box marginY={1}>
        <Text dimColor>{description}</Text>
      </Box>
      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          onCancel={onBack}
          placeholder={placeholder}
          mask={masked ? '*' : undefined}
        />
      </Box>
      {hint && (
        <Box marginTop={1}>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
    </Box>
  );
};

interface OAuthStepProps {
  status: string;
  onBack: () => void;
}

const OAuthStep: React.FC<OAuthStepProps> = ({ status, onBack }) => {
  useInput((input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>OAuth Authorization</Text>
      <Box marginY={1}>
        <Text dimColor>
          A browser window will open for you to authorize access to your Craft documents.
        </Text>
      </Box>
      <Box marginY={1}>
        <Text color="cyan">●</Text>
        <Text> {status}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Complete the authorization in your browser, then return here.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Esc to go back and cancel</Text>
      </Box>
    </Box>
  );
};

interface ConfirmStepProps {
  authType: AuthType;
  apiKey?: string;
  oauthToken?: string;
  mcpUrl: string;
  isPublic: boolean;
  oauthAuthenticated: boolean;
  bearerToken?: string;
  onConfirm: () => void;
  onBack: () => void;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({
  authType,
  apiKey,
  oauthToken,
  mcpUrl,
  isPublic,
  oauthAuthenticated,
  bearerToken,
  onConfirm,
  onBack,
}) => {
  useInput((input, key) => {
    if (key.return) {
      onConfirm();
    }
    if (key.escape) {
      onBack();
    }
  });

  const getMcpAuthStatus = () => {
    if (isPublic) {
      return { color: 'blue' as const, text: '○ Public (no auth required)' };
    }
    if (oauthAuthenticated) {
      return { color: 'green' as const, text: '✓ OAuth authenticated' };
    }
    if (bearerToken) {
      return { color: 'green' as const, text: '✓ Bearer token' };
    }
    return { color: 'red' as const, text: '✗ Not authenticated' };
  };

  const mcpAuthStatus = getMcpAuthStatus();

  return (
    <Box flexDirection="column">
      <Text bold>Please confirm your settings:</Text>
      <Box flexDirection="column" marginY={1} marginLeft={2}>
        <Box>
          <Text dimColor>Claude Auth: </Text>
          <Text color="cyan">{authType === 'api_key' ? 'API Key' : 'Max Subscription'}</Text>
        </Box>
        {authType === 'api_key' && apiKey && (
          <Box>
            <Text dimColor>API Key: </Text>
            <Text>{apiKey}</Text>
          </Box>
        )}
        {authType === 'oauth_token' && oauthToken && (
          <Box>
            <Text dimColor>OAuth Token: </Text>
            <Text>{oauthToken}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>MCP URL: </Text>
          <Text>{mcpUrl}</Text>
        </Box>
        <Box>
          <Text dimColor>MCP Auth: </Text>
          <Text color={mcpAuthStatus.color}>{mcpAuthStatus.text}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Configuration will be saved to: </Text>
        <Text>{getConfigPath()}</Text>
      </Box>
      <Box marginTop={2}>
        <Text color="green" bold>Press Enter to save, or Esc to go back</Text>
      </Box>
    </Box>
  );
};

interface OAuthTokenStepProps {
  existingToken: string | null;
  hasClaudeCli: boolean;
  onUseExisting: () => void;
  onRunSetup: () => void;
  onManualEntry: (token: string) => void;
  onBack: () => void;
  error?: string | null;
}

const OAuthTokenStep: React.FC<OAuthTokenStepProps> = ({
  existingToken,
  hasClaudeCli,
  onUseExisting,
  onRunSetup,
  onManualEntry,
  onBack,
  error,
}) => {
  const [mode, setMode] = useState<'select' | 'manual'>('select');
  const [manualToken, setManualToken] = useState('');
  const [selected, setSelected] = useState(0);

  // Build options based on what's available
  const options: { id: string; label: string; desc: string; action: () => void }[] = [];

  if (existingToken) {
    options.push({
      id: 'existing',
      label: 'Use existing token',
      desc: `Found token: ${existingToken.slice(0, 20)}...`,
      action: onUseExisting,
    });
  }

  if (hasClaudeCli) {
    options.push({
      id: 'setup',
      label: 'Run claude setup-token',
      desc: 'Opens browser to authenticate with your Max subscription',
      action: onRunSetup,
    });
  }

  options.push({
    id: 'manual',
    label: 'Enter token manually',
    desc: 'Paste a token you already have',
    action: () => setMode('manual'),
  });

  useInput((input, key) => {
    // Only handle selection mode - manual mode uses TextInput
    if (mode !== 'select') return;

    if (key.upArrow && selected > 0) {
      setSelected(selected - 1);
    } else if (key.downArrow && selected < options.length - 1) {
      setSelected(selected + 1);
    } else if (key.return) {
      options[selected]?.action();
    } else if (key.escape) {
      onBack();
    }
  }, { isActive: mode === 'select' });

  if (mode === 'manual') {
    return (
      <Box flexDirection="column">
        <Text bold>Enter OAuth Token</Text>
        <Box marginY={1}>
          <Text dimColor>Paste your Claude Max OAuth token below.</Text>
        </Box>
        <Box>
          <Text color="green">&gt; </Text>
          <TextInput
            value={manualToken}
            onChange={setManualToken}
            onSubmit={(value) => {
              if (value.trim()) onManualEntry(value.trim());
            }}
            onCancel={() => {
              setMode('select');
              setManualToken('');
            }}
            placeholder="sk-ant-oat01-..."
            mask="*"
            maskReveal={{ first: 12 }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter to confirm, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Claude Max OAuth Token</Text>
      <Box marginY={1}>
        <Text dimColor>Choose how to provide your Claude Max token:</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.id} flexDirection="column">
            <Box>
              <Text color={selected === i ? 'green' : undefined}>
                {selected === i ? '❯ ' : '  '}
              </Text>
              <Text color={selected === i ? 'green' : undefined} bold={selected === i}>
                {opt.label}
              </Text>
            </Box>
            {selected === i && (
              <Box marginLeft={4}>
                <Text dimColor>{opt.desc}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to select, Enter to confirm, Esc to go back</Text>
      </Box>

      {!hasClaudeCli && (
        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            Note: Claude CLI not found. Install it to use automatic token setup.
          </Text>
        </Box>
      )}
    </Box>
  );
};

// No OAuth options - shown when OAuth is not detected or fails
interface NoOAuthOptionsStepProps {
  onSelect: (method: 'bearer' | 'public') => void;
  onBack: () => void;
  message?: string;
}

const NoOAuthOptionsStep: React.FC<NoOAuthOptionsStepProps> = ({ onSelect, onBack, message }) => {
  const [selected, setSelected] = useState(0);
  const options = [
    { label: 'Enter Bearer Token', value: 'bearer' as const },
    { label: 'No authentication (public server)', value: 'public' as const },
  ];

  useInput((_, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected(s => Math.min(options.length - 1, s + 1));
    } else if (key.return) {
      const option = options[selected];
      if (option) onSelect(option.value);
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Choose Authentication Method</Text>
      {message && (
        <Box marginY={1}>
          <Text dimColor>{message}</Text>
        </Box>
      )}
      <Box marginY={1} flexDirection="column">
        {options.map((opt, i) => (
          <Text key={opt.value}>
            <Text color={i === selected ? 'green' : undefined}>
              {i === selected ? '> ' : '  '}{opt.label}
            </Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>Use arrow keys to select, Enter to confirm, Esc to go back</Text>
    </Box>
  );
};

// Bearer token input step
interface BearerTokenStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
}

const BearerTokenStep: React.FC<BearerTokenStepProps> = ({ value, onChange, onSubmit, onBack }) => {
  return (
    <Box flexDirection="column">
      <Text bold>Enter Bearer Token</Text>
      <Box marginY={1}>
        <Text dimColor>The token will be sent as: Authorization: Bearer {'<token>'}</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onBack}
          placeholder="Paste your bearer token..."
          mask="•"
          maskReveal={{ last: 4 }}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to confirm, Esc to go back</Text>
      </Box>
    </Box>
  );
};
