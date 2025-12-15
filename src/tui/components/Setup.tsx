import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { saveConfig, getConfigPath, generateWorkspaceId, loadStoredConfig, getActiveWorkspace, type StoredConfig, type Workspace, type AuthType, type OAuthCredentials, type McpAuthType } from '../../config/storage.ts';
import { type AuthState, type SetupNeeds } from '../../auth/state.ts';
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '../../auth/claude-token.ts';
import { getCredentialManager } from '../../credentials/index.ts';
import { validateMcpConnection, getValidationErrorMessage } from '../../mcp/validation.ts';
import { CraftOAuth, getMcpBaseUrl } from '../../auth/oauth.ts';
import { TextInput } from './TextInput.tsx';
import { AnimatedSpinner } from './Spinner.tsx';
import { CraftCallbackStep, type CraftProfile } from './craftAuth/CraftCallbackStep.tsx';
import { CraftSpaceSelector, McpLinkSelector, type McpLink } from './craftAuth/CraftSpaceSelector.tsx';
import { CraftApi } from '../../clients/craftApi.ts';

// Streamlined flow: Craft Login (includes subscription check) -> Select Space -> [Select MCP] -> MCP Validation -> Billing -> [Credentials] -> Save
type SetupStep =
  | 'welcome'
  | 'craft-login'        // Craft OAuth + subscription check (mandatory first step)
  | 'select-space'       // Select Craft space
  | 'select-mcp'         // Select existing MCP or create new (if multiple exist)
  | 'mcp-validating'     // Validate MCP connection (after space/mcp selection)
  | 'mcp-auth'           // MCP OAuth if server requires it
  | 'billing-method'     // Choose: craft_credits | api_key | oauth_token
  | 'api-key-entry'      // Enter Anthropic API key
  | 'oauth-token-entry'  // Enter Claude Max OAuth token
  | 'oauth-token-setup'  // Running claude setup-token
  | 'saving'             // Saving configuration
  | 'complete'
  | 'error';

export interface SetupProps {
  onComplete: (config: StoredConfig) => void;
  onCancel: () => void;
  /** Current auth state from getAuthState() */
  authState: AuthState;
  /** Derived setup needs from getSetupNeeds() */
  setupNeeds: SetupNeeds;
}

/**
 * Determine the initial setup step based on what's missing
 */
function getInitialStep(setupNeeds: SetupNeeds, authState: AuthState): SetupStep {
  if (setupNeeds.needsCraftAuth) {
    // Need Craft auth and/or workspace - start from beginning
    return 'craft-login';
  }
  if (setupNeeds.needsBillingConfig) {
    // Have Craft + workspace, just need billing config
    return 'billing-method';
  }
  if (setupNeeds.needsCredentials) {
    // Have billing type, just need to enter credentials
    if (authState.billing.type === 'api_key') return 'api-key-entry';
    if (authState.billing.type === 'oauth_token') return 'oauth-token-entry';
  }
  // Fully configured - shouldn't be in setup, but default to complete
  return 'complete';
}

export const Setup: React.FC<SetupProps> = ({ onComplete, onCancel, authState, setupNeeds }) => {
  const { exit } = useApp();

  // Determine initial step based on what's missing
  const [step, setStep] = useState<SetupStep>(() => getInitialStep(setupNeeds, authState));

  // Craft login state - initialize from authState if available
  const [craftToken, setCraftToken] = useState<string | null>(authState.craft.token);
  const [craftProfile, setCraftProfile] = useState<CraftProfile | null>(null);

  // Space/MCP selection state - initialize from authState if available
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [selectedSpaceName, setSelectedSpaceName] = useState<string>(
    authState.workspace.active?.name || ''
  );
  const [mcpLinks, setMcpLinks] = useState<Array<{ name: string; linkId: string; mcpUrl: string }>>([]);
  const [mcpUrl, setMcpUrl] = useState(authState.workspace.active?.mcpUrl || '');

  // MCP OAuth state (for servers that require additional OAuth)
  const [mcpOAuthStatus, setMcpOAuthStatus] = useState('');
  const [mcpOAuthResult, setMcpOAuthResult] = useState<OAuthCredentials | null>(null);
  const [mcpOAuthClient, setMcpOAuthClient] = useState<CraftOAuth | null>(null);

  // Billing method state - initialize from authState if available
  const [billingMethod, setBillingMethod] = useState<AuthType>(
    authState.billing.type || 'craft_credits'
  );
  const [apiKey, setApiKey] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [oauthStatus, setOauthStatus] = useState('');

  // Derive whether we have existing workspace (for back navigation logic)
  const hasExistingWorkspace = authState.workspace.hasWorkspace;
  const existingWorkspace = authState.workspace.active;

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Claude CLI state (for Claude Max option)
  const [hasClaudeCli, setHasClaudeCli] = useState(false);
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null);
  const [envApiKey, setEnvApiKey] = useState<string | null>(null);
  const [envApiKeyVar, setEnvApiKeyVar] = useState<string | null>(null);

  // Check for Claude CLI and ANTHROPIC_API_KEY env var on mount
  useEffect(() => {
    setHasClaudeCli(isClaudeCliInstalled());

    // Check for API key environment variables (CRAFT_ prefix takes priority)
    const craftApiKey = process.env.CRAFT_ANTHROPIC_API_KEY;
    const standardApiKey = process.env.ANTHROPIC_API_KEY;

    if (craftApiKey && craftApiKey.startsWith('sk-ant-')) {
      setEnvApiKey(craftApiKey);
      setEnvApiKeyVar('CRAFT_ANTHROPIC_API_KEY');
    } else if (standardApiKey && standardApiKey.startsWith('sk-ant-')) {
      setEnvApiKey(standardApiKey);
      setEnvApiKeyVar('ANTHROPIC_API_KEY');
    }
  }, []);

  // Handle Ctrl+C to cancel
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (step === 'welcome') {
        exit();
      } else {
        // Cancel MCP OAuth if in progress
        if (mcpOAuthClient) {
          mcpOAuthClient.cancel();
          setMcpOAuthClient(null);
        }
        onCancel();
      }
    }

    // Toggle visibility for sensitive fields
    if (key.ctrl && input === 'v') {
      if (step === 'api-key-entry') setShowApiKey(!showApiKey);
    }

    // Handle MCP validation step retry/back
    if (step === 'mcp-validating' && validationError) {
      if (key.return) {
        // Retry validation
        validateMcp();
      } else if (key.escape) {
        // Go back to space selection
        setValidationError(null);
        setStep('select-space');
      }
    }
  });

  // === NEW HANDLERS FOR CRAFT-FIRST FLOW ===

  // Welcome -> Craft Login (or billing-method if hasExistingWorkspace)
  // For new users, we skip welcome and go straight to craft-login
  const handleWelcome = useCallback(() => {
    // Only used when hasExistingWorkspace - skip to billing method
    setStep('billing-method');
  }, []);

  // Craft OAuth complete -> Subscription Check
  const handleCraftLoginComplete = useCallback(async (token: string, profile: CraftProfile) => {
    setCraftToken(token);
    setCraftProfile(profile);

    setStep('select-space');
  }, []);

  // Space selected -> Check for existing MCP links
  const handleSpaceSelected = useCallback(async (spaceId: string, spaceName: string) => {
    setSelectedSpaceId(spaceId);
    setSelectedSpaceName(spaceName);

    if (!craftToken) return;

    // Show loading state
    setStep('mcp-validating');
    setValidationError(null);

    try {
      const craftApi = new CraftApi();
      const workflowLinks = await craftApi.getWorkflowLinks({ authToken: craftToken, spaceId });

      // Filter for fullSpace MCP links that are enabled
      const fullSpaceMcpLinks = workflowLinks
        .filter(link => link.type === 'mcp' && link.scope === 'fullSpace' && link.enabled && link.urls?.mcp)
        .map(link => ({
          name: link.name,
          linkId: link.linkId,
          mcpUrl: link.urls.mcp!,
        }));

      if (fullSpaceMcpLinks.length > 0) {
        // Multiple MCP links exist - show selection step
        setMcpLinks(fullSpaceMcpLinks);
        setStep('select-mcp');
      } else {
        // No existing MCP links - create one automatically
        await createNewMcpLink(spaceId, spaceName);
      }
    } catch (err) {
      // If we can't get workflow links, try creating a new one
      await createNewMcpLink(spaceId, spaceName);
    }
  }, [craftToken]);

  // Create a new MCP link for the space
  const createNewMcpLink = useCallback(async (spaceId?: string, spaceName?: string) => {
    const id = spaceId || selectedSpaceId;
    const name = spaceName || selectedSpaceName;
    if (!id || !name || !craftToken) return;

    setStep('mcp-validating');
    setValidationError(null);

    try {
      const craftApi = new CraftApi();
      const link = await craftApi.createSpaceWorkflowLink({
        authToken: craftToken,
        spaceId: id,
        name: 'Craft Agent MCP',
        type: 'mcp',
        scope: 'fullSpace'
      });

      if (link.urls?.mcp) {
        setMcpUrl(link.urls.mcp);
        // Now validate the MCP connection
        validateMcp(link.urls.mcp);
      } else {
        setValidationError('Failed to create MCP connection');
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Failed to create MCP connection');
    }
  }, [craftToken, selectedSpaceId, selectedSpaceName]);

  // MCP link selected -> Validate MCP
  const handleMcpSelected = useCallback(async (url: string) => {
    setMcpUrl(url);
    setStep('mcp-validating');
    validateMcp(url);
  }, [craftToken]);

  // Validate MCP connection - called after space selection
  const validateMcp = useCallback(async (urlOverride?: string) => {
    const url = urlOverride || mcpUrl;
    setValidationError(null);

    try {
      const manager = getCredentialManager();
      const craftOAuthToken = await manager.getCraftOAuth();

      // Try to validate the MCP connection
      const validationResult = await validateMcpConnection({
        mcpUrl: url,
        mcpAccessToken: craftOAuthToken || undefined,
      });

      if (validationResult.errorType === 'needs-auth') {
        // MCP server requires OAuth - start OAuth flow
        setStep('mcp-auth');
        startMcpOAuth(url);
      } else if (validationResult.success) {
        // Connected! Proceed to billing
        setStep('billing-method');
      } else {
        // Failed - show error
        setValidationError(getValidationErrorMessage(validationResult));
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Failed to validate MCP connection');
    }
  }, [mcpUrl]);

  // Start MCP OAuth flow
  const startMcpOAuth = useCallback(async (url: string) => {
    const mcpBaseUrl = getMcpBaseUrl(url);
    const oauth = new CraftOAuth(
      { mcpBaseUrl },
      {
        onStatus: (message) => setMcpOAuthStatus(message),
        onError: (errorMsg) => {
          setError(errorMsg);
          setStep('error');
        },
      }
    );

    setMcpOAuthClient(oauth);

    try {
      const { tokens, clientId } = await oauth.authenticate();
      const oauthCreds: OAuthCredentials = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        clientId,
        tokenType: tokens.tokenType,
      };
      setMcpOAuthResult(oauthCreds);
      setMcpOAuthClient(null);
      // OAuth successful, proceed to billing
      setStep('billing-method');
    } catch (err) {
      setMcpOAuthClient(null);
      setError(err instanceof Error ? err.message : 'MCP OAuth authentication failed');
      setStep('error');
    }
  }, []);

  // Save configuration - called after credentials are gathered
  // MCP is already validated at this point
  const saveConfiguration = useCallback(async (
    method: AuthType,
    apiKeyOverride?: string,
    oauthTokenOverride?: string
  ) => {
    setStep('saving');

    try {
      const manager = getCredentialManager();
      const finalApiKey = apiKeyOverride || apiKey;
      const finalOauthToken = oauthTokenOverride || oauthToken;

      // Save credentials based on billing method
      if (method === 'api_key' && finalApiKey) {
        await manager.setApiKey(finalApiKey);
      } else if (method === 'oauth_token' && finalOauthToken) {
        await manager.setClaudeOAuth(finalOauthToken);
      }
      // For craft_credits, Craft OAuth is already saved by CraftSpaceSelector

      // Save MCP OAuth credentials if we obtained them
      // (Will be used later when creating the workspace)

      // Reuse existing workspace or create new one
      let workspace: Workspace;
      let workspaceId: string;

      if (hasExistingWorkspace && existingWorkspace) {
        // Reuse existing workspace (just updating billing method)
        workspace = existingWorkspace;
        workspaceId = existingWorkspace.id;
      } else {
        // Create new workspace from MCP URL
        workspaceId = generateWorkspaceId();
        workspace = {
          id: workspaceId,
          name: selectedSpaceName || 'Craft Workspace',
          mcpUrl: mcpUrl,
          mcpAuthType: mcpOAuthResult ? 'workspace_oauth' as McpAuthType : 'public' as McpAuthType,
          createdAt: Date.now(),
        };
      }

      // Save MCP OAuth credentials to workspace if obtained
      if (mcpOAuthResult) {
        await manager.setWorkspaceOAuth(workspaceId, {
          accessToken: mcpOAuthResult.accessToken,
          refreshToken: mcpOAuthResult.refreshToken,
          expiresAt: mcpOAuthResult.expiresAt,
          clientId: mcpOAuthResult.clientId,
          tokenType: mcpOAuthResult.tokenType,
        });
      }

      // Load existing config to preserve other workspaces
      const existingConfig = loadStoredConfig();
      const existingWorkspaces = existingConfig?.workspaces || [];

      // Update or add the workspace
      let updatedWorkspaces: Workspace[];
      if (hasExistingWorkspace && existingWorkspace) {
        // Keep all existing workspaces as-is (we're just changing billing method)
        updatedWorkspaces = existingWorkspaces;
      } else {
        // Add new workspace
        updatedWorkspaces = [...existingWorkspaces.filter(w => w.id !== workspaceId), workspace];
      }

      // Build config (credentials stored in credential store, not here)
      // activeSessionId is null - session will be created on first use
      const config: StoredConfig = {
        authType: method,
        workspaces: updatedWorkspaces,
        activeWorkspaceId: workspaceId,
        activeSessionId: null,
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
  }, [apiKey, oauthToken, mcpUrl, selectedSpaceName, onComplete, hasExistingWorkspace, existingWorkspace, mcpOAuthResult]);

  // Billing method selected -> Credentials entry or Save
  const handleBillingMethodSelect = useCallback((method: AuthType) => {
    setBillingMethod(method);
    if (method === 'craft_credits') {
      // No additional credentials needed - go straight to save
      saveConfiguration(method);
    } else if (method === 'api_key') {
      // If ANTHROPIC_API_KEY is in environment, skip to save (env backend will provide it)
      if (envApiKey) {
        saveConfiguration(method);
      } else {
        setStep('api-key-entry');
      }
    } else {
      // oauth_token - check for existing Claude token first
      const existing = getExistingClaudeToken();
      if (existing) {
        setExistingClaudeToken(existing);
      }
      setStep('oauth-token-entry');
    }
  }, [saveConfiguration, envApiKey]);

  // API key entered -> Save
  const handleApiKeySubmit = useCallback((value: string) => {
    if (!value.trim()) return;
    setApiKey(value.trim());
    saveConfiguration('api_key', value.trim());
  }, [saveConfiguration]);

  // Use existing Claude token -> Save
  const handleUseExistingToken = useCallback(() => {
    if (existingClaudeToken) {
      setOauthToken(existingClaudeToken);
      saveConfiguration('oauth_token', undefined, existingClaudeToken);
    }
  }, [existingClaudeToken, saveConfiguration]);

  // Run claude setup-token
  const handleRunSetupToken = useCallback(async () => {
    setStep('oauth-token-setup');

    const result = await runClaudeSetupToken((status) => {
      setOauthStatus(status);
    });

    if (result.success && result.token) {
      setOauthToken(result.token);
      setExistingClaudeToken(result.token);
      saveConfiguration('oauth_token', undefined, result.token);
    } else {
      setError(result.error || 'Failed to get token');
      setStep('oauth-token-entry');
    }
  }, [saveConfiguration]);

  const handleBack = useCallback(() => {
    setError(null);
    setValidationError(null);
    switch (step) {
      case 'craft-login':
        // New users pressing back on first step - cancel/exit
        onCancel();
        break;
      case 'select-space':
        // Go back to craft login (need to re-auth)
        setCraftToken(null);
        setCraftProfile(null);
        setStep('craft-login');
        break;
      case 'select-mcp':
        // Go back to space selection
        setMcpLinks([]);
        setStep('select-space');
        break;
      case 'mcp-validating':
      case 'mcp-auth':
        // Cancel MCP OAuth if in progress
        if (mcpOAuthClient) {
          mcpOAuthClient.cancel();
          setMcpOAuthClient(null);
        }
        setMcpOAuthResult(null);
        // Go back to MCP selection if we have links, otherwise space selection
        if (mcpLinks.length > 0) {
          setStep('select-mcp');
        } else {
          setStep('select-space');
        }
        break;
      case 'billing-method':
        if (hasExistingWorkspace) {
          // Go back to welcome if existing MCP
          setStep('welcome');
        } else {
          // Go back to space selection (MCP is already validated, can try different space)
          setStep('select-space');
        }
        break;
      case 'api-key-entry':
      case 'oauth-token-entry':
      case 'oauth-token-setup':
        setStep('billing-method');
        break;
      case 'error':
        if (hasExistingWorkspace) {
          setStep('welcome');
        } else {
          setStep('craft-login');
        }
        break;
    }
  }, [step, hasExistingWorkspace, mcpOAuthClient, onCancel]);

  const totalSteps = hasExistingWorkspace ? 4 : 6;
  const currentStep = getStepNumber(step, hasExistingWorkspace);

  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      {/* Centered container */}
      <Box flexDirection="column" width={64}>
        {/* Header */}
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">✦ Craft Agent Setup</Text>
        </Box>

        {/* Progress indicator - visual dots */}
        <Box justifyContent="center" marginBottom={1} gap={1}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <Text key={i} color={i < currentStep ? 'cyan' : 'gray'}>
              {i < currentStep ? '●' : i === currentStep - 1 ? '◉' : '○'}
            </Text>
          ))}
        </Box>

        {/* Step name */}
        <Box justifyContent="center" marginBottom={1}>
          <Text dimColor>{getStepName(step)}</Text>
        </Box>

        {/* Step content */}
        <Box flexDirection="column" marginY={1}>
        {step === 'welcome' && (
          <WelcomeStep onContinue={handleWelcome} onExit={exit} hasExistingWorkspace={hasExistingWorkspace} />
        )}

        {step === 'craft-login' && (
          <CraftCallbackStep
            onComplete={({ token, profile }) => handleCraftLoginComplete(token, profile)}
            onBack={handleBack}
          />
        )}

        {step === 'select-space' && craftProfile && (
          <CraftSpaceSelector
            profile={craftProfile}
            onSelect={handleSpaceSelected}
            onBack={handleBack}
          />
        )}

        {step === 'select-mcp' && (
          <McpLinkSelector
            spaceName={selectedSpaceName}
            mcpLinks={mcpLinks}
            onSelect={handleMcpSelected}
            onCreateNew={() => createNewMcpLink()}
            onBack={handleBack}
          />
        )}

        {step === 'mcp-validating' && (
          <Box flexDirection="column" alignItems="center">
            {validationError ? (
              <>
                <Text color="red">✗ Connection failed</Text>
                <Box marginY={1}>
                  <Text dimColor>{validationError}</Text>
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>↵ retry • Esc back</Text>
                </Box>
              </>
            ) : (
              <Box>
                <AnimatedSpinner />
                <Text> Connecting to {selectedSpaceName || 'workspace'}...</Text>
              </Box>
            )}
          </Box>
        )}

        {step === 'mcp-auth' && (
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>The server requires additional authentication.</Text>
            <Box marginY={1}>
              <AnimatedSpinner />
              <Text> {mcpOAuthStatus || 'Opening browser...'}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Complete in your browser • Esc to cancel</Text>
            </Box>
          </Box>
        )}

        {step === 'billing-method' && (
          <BillingMethodStep
            onSelect={handleBillingMethodSelect}
            onBack={handleBack}
            envApiKey={envApiKey}
            envApiKeyVar={envApiKeyVar}
          />
        )}

        {step === 'api-key-entry' && (
          <InputStep
            title="Anthropic API Key"
            description="Enter your Anthropic API key. Get one at console.anthropic.com"
            placeholder="sk-ant-..."
            value={apiKey}
            masked={!showApiKey}
            onSubmit={handleApiKeySubmit}
            onBack={handleBack}
            hint="Press Ctrl+V to toggle visibility"
          />
        )}

        {step === 'oauth-token-entry' && (
          <OAuthTokenStep
            existingToken={existingClaudeToken}
            hasClaudeCli={hasClaudeCli}
            onUseExisting={handleUseExistingToken}
            onRunSetup={handleRunSetupToken}
            onBack={handleBack}
            error={error}
          />
        )}

        {step === 'oauth-token-setup' && (
          <Box flexDirection="column" alignItems="center">
            <Box marginY={1}>
              <AnimatedSpinner />
              <Text> {oauthStatus || 'Opening browser...'}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Complete authentication in your browser</Text>
            </Box>
          </Box>
        )}

        {step === 'saving' && (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <AnimatedSpinner />
              <Text> Saving configuration...</Text>
            </Box>
          </Box>
        )}

        {step === 'complete' && (
          <Box flexDirection="column" alignItems="center">
            <Text color="green">✓ Setup complete!</Text>
            <Box marginTop={1}>
              <Text dimColor>Starting Craft Agent...</Text>
            </Box>
          </Box>
        )}

        {step === 'error' && (
          <Box flexDirection="column" alignItems="center">
            <Text color="red">✗ Setup failed</Text>
            <Box marginY={1}>
              <Text dimColor>{error}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↵ retry • Ctrl+C exit</Text>
            </Box>
          </Box>
        )}
        </Box>

        {/* Footer */}
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>Ctrl+C to cancel</Text>
        </Box>
      </Box>
    </Box>
  );
};

function getStepNumber(step: SetupStep, hasExistingWorkspace: boolean = false): number {
  if (hasExistingWorkspace) {
    // Shortened flow: welcome -> billing-method -> credentials -> save (4 steps)
    switch (step) {
      case 'welcome': return 1;
      case 'billing-method': return 2;
      case 'api-key-entry':
      case 'oauth-token-entry':
      case 'oauth-token-setup':
        return 3;
      case 'saving':
      case 'complete':
      case 'error':
        return 4;
      default: return 4;
    }
  }
  // New user flow: craft-login -> select-space -> select-mcp/mcp-validate -> billing -> credentials -> save (6 steps)
  switch (step) {
    case 'craft-login': return 1;
    case 'select-space': return 2;
    case 'select-mcp':
    case 'mcp-validating':
    case 'mcp-auth':
      return 3;
    case 'billing-method': return 4;
    case 'api-key-entry':
    case 'oauth-token-entry':
    case 'oauth-token-setup':
      return 5;
    case 'saving':
    case 'complete':
    case 'error':
      return 6;
    default: return 6;
  }
}

function getStepName(step: SetupStep): string {
  switch (step) {
    case 'welcome': return 'Welcome';
    case 'craft-login': return 'Sign In';
    case 'select-space': return 'Select Space';
    case 'select-mcp': return 'Select Connection';
    case 'mcp-validating': return 'Connecting';
    case 'mcp-auth': return 'Authenticate';
    case 'billing-method': return 'Billing';
    case 'api-key-entry': return 'API Key';
    case 'oauth-token-entry': return 'Claude Token';
    case 'oauth-token-setup': return 'Setting up...';
    case 'saving': return 'Saving...';
    case 'complete': return 'Complete';
    case 'error': return 'Error';
  }
}

// Sub-components

interface WelcomeStepProps {
  onContinue: () => void;
  onExit: () => void;
  hasExistingWorkspace?: boolean;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onContinue, onExit }) => {
  useInput((input, key) => {
    if (key.return) {
      onContinue();
    } else if (key.escape) {
      onExit();
    }
  });

  // This is only shown for existing users changing billing settings
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>Your Craft space is already connected.</Text>
      <Text dimColor>Press Enter to update your billing settings.</Text>
    </Box>
  );
};

interface BillingMethodStepProps {
  onSelect: (method: AuthType) => void;
  onBack: () => void;
  envApiKey?: string | null;
  envApiKeyVar?: string | null;
}

const BillingMethodStep: React.FC<BillingMethodStepProps> = ({ onSelect, onBack, envApiKey, envApiKeyVar }) => {
  const [selected, setSelected] = useState<number>(0);

  const options: { id: AuthType; label: string; desc: string }[] = [
    {
      id: 'craft_credits',
      label: 'Craft Credits',
      desc: 'Use your Craft subscription (no extra setup)',
    },
    {
      id: 'api_key',
      label: envApiKey ? `Use ${envApiKeyVar} from env` : 'API Key',
      desc: envApiKey ? 'Use the API key from your environment' : 'Pay-as-you-go via Anthropic',
    },
    {
      id: 'oauth_token',
      label: 'Claude Pro/Max',
      desc: 'Use your Claude subscription',
    },
  ];

  useInput((input, key) => {
    if (key.upArrow && selected > 0) {
      setSelected(s => s - 1);
    } else if (key.downArrow && selected < options.length - 1) {
      setSelected(s => s + 1);
    } else if (key.return) {
      const opt = options[selected];
      if (opt) onSelect(opt.id);
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>How would you like to pay for AI usage?</Text>

      {envApiKey && envApiKeyVar && (
        <Box marginTop={1}>
          <Text color="green">✓ Found {envApiKeyVar} in environment</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.id} flexDirection="column">
            <Box>
              <Text color={selected === i ? 'cyan' : undefined}>
                {selected === i ? '› ' : '  '}
              </Text>
              <Text color={selected === i ? 'cyan' : 'white'} bold={selected === i}>
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
        <Text dimColor>↑↓ navigate • ↵ select • Esc back</Text>
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
      <Text dimColor>{description}</Text>
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginY={1}>
        <Text color="cyan">› </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          onCancel={onBack}
          placeholder={placeholder}
          mask={masked ? '*' : undefined}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↵ confirm • Esc back{hint ? ` • ${hint}` : ''}</Text>
      </Box>
    </Box>
  );
};

interface OAuthTokenStepProps {
  existingToken: string | null;
  hasClaudeCli: boolean;
  onUseExisting: () => void;
  onRunSetup: () => void;
  onBack: () => void;
  error?: string | null;
}

const OAuthTokenStep: React.FC<OAuthTokenStepProps> = ({
  existingToken,
  hasClaudeCli,
  onUseExisting,
  onRunSetup,
  onBack,
  error,
}) => {
  // If neither token nor CLI available, show no-options mode
  const mode: 'select' | 'no-options' = (!existingToken && !hasClaudeCli) ? 'no-options' : 'select';
  const [selected, setSelected] = useState(0);

  // Build options based on what's available
  const options: { id: string; label: string; desc: string; action: () => void }[] = [];

  if (existingToken) {
    options.push({
      id: 'existing',
      label: 'Use existing token',
      desc: `Found: ${existingToken.slice(0, 20)}...`,
      action: onUseExisting,
    });
  }

  if (hasClaudeCli) {
    options.push({
      id: 'setup',
      label: 'Run claude setup-token',
      desc: 'Opens browser to authenticate',
      action: onRunSetup,
    });
  }

  useInput((_input, key) => {
    if (mode === 'no-options') {
      if (key.escape) {
        onBack();
      }
      return;
    }

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
  }, { isActive: mode === 'select' || mode === 'no-options' });

  if (mode === 'no-options') {
    return (
      <Box flexDirection="column">
        <Box marginY={1}>
          <Text color="yellow">Claude CLI is required for Claude Max authentication.</Text>
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text dimColor>To use Claude Max, install the Claude CLI:</Text>
          <Box marginTop={1} marginLeft={2}>
            <Text color="cyan">npm install -g @anthropic-ai/claude-code</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Then run this setup again.</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>Choose how to provide your Claude Max token:</Text>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.id} flexDirection="column">
            <Box>
              <Text color={selected === i ? 'cyan' : undefined}>
                {selected === i ? '› ' : '  '}
              </Text>
              <Text color={selected === i ? 'cyan' : 'white'} bold={selected === i}>
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
        <Text dimColor>↑↓ navigate • ↵ select • Esc back</Text>
      </Box>
    </Box>
  );
};

