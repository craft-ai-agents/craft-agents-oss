import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { saveConfig, generateWorkspaceId, loadStoredConfig, type StoredConfig, type Workspace, type AuthType } from '@craft-agent/shared/config';
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces';
import { type AuthState, type SetupNeeds } from '@craft-agent/shared/auth';
import { getExistingClaudeToken, isClaudeCliInstalled, runClaudeSetupToken } from '@craft-agent/shared/auth';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { TextInput } from './TextInput.tsx';
import { AnimatedSpinner } from './Spinner.tsx';
import { CraftCallbackStep, type CraftProfile } from './craftAuth/CraftCallbackStep.tsx';

// Simplified flow: Welcome -> Billing Method -> [Craft Login if credits] -> [Credentials if API/Claude] -> Complete
type SetupStep =
  | 'welcome'
  | 'billing-method'     // Choose: craft_credits | api_key | oauth_token
  | 'craft-login'        // Craft OAuth (only if craft_credits selected)
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
  if (setupNeeds.needsBillingConfig) {
    return 'billing-method';
  }
  if (setupNeeds.needsCredentials) {
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

  // Billing method state
  const [billingMethod, setBillingMethod] = useState<AuthType>(
    authState.billing.type || 'craft_credits'
  );
  const [apiKey, setApiKey] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [oauthStatus, setOauthStatus] = useState('');

  // UI state
  const [error, setError] = useState<string | null>(null);
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
        onCancel();
      }
    }

    // Toggle visibility for sensitive fields
    if (key.ctrl && input === 'v') {
      if (step === 'api-key-entry') setShowApiKey(!showApiKey);
    }
  });

  // Save configuration - called after credentials are gathered
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
      // For craft_credits, Craft OAuth is already saved by CraftCallbackStep

      // Create default workspace if none exists
      const existingConfig = loadStoredConfig();
      const existingWorkspaces = existingConfig?.workspaces || [];

      let workspace: Workspace;
      let workspaceId: string;

      if (existingWorkspaces.length > 0) {
        // Use existing workspace
        workspace = existingWorkspaces[0]!;
        workspaceId = workspace.id;
      } else {
        // Create default workspace
        workspaceId = generateWorkspaceId();
        workspace = {
          id: workspaceId,
          name: 'Default',
          rootPath: `${getDefaultWorkspacesDir()}/${workspaceId}`,
          createdAt: Date.now(),
        };
      }

      const updatedWorkspaces = existingWorkspaces.length > 0
        ? existingWorkspaces
        : [workspace];

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
  }, [apiKey, oauthToken, onComplete]);

  // Craft OAuth complete -> Save
  const handleCraftLoginComplete = useCallback(async (_token: string, _profile: CraftProfile) => {
    // Craft OAuth token is already saved by CraftCallbackStep
    saveConfiguration('craft_credits');
  }, [saveConfiguration]);

  // Billing method selected -> Credentials entry or Save
  const handleBillingMethodSelect = useCallback((method: AuthType) => {
    setBillingMethod(method);
    if (method === 'craft_credits') {
      // Need Craft OAuth - go to craft login
      setStep('craft-login');
    } else if (method === 'api_key') {
      // If ANTHROPIC_API_KEY is in environment, skip to save
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
    switch (step) {
      case 'welcome':
      case 'billing-method':
        onCancel();
        break;
      case 'craft-login':
      case 'api-key-entry':
      case 'oauth-token-entry':
      case 'oauth-token-setup':
        setStep('billing-method');
        break;
      case 'error':
        setStep('billing-method');
        break;
    }
  }, [step, onCancel]);

  const totalSteps = 3; // billing -> credentials/login -> complete
  const currentStep = getStepNumber(step);

  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      {/* Centered container */}
      <Box flexDirection="column" width={64}>
        {/* Header */}
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">Welcome to Craft Agents</Text>
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
          <WelcomeStep onContinue={() => setStep('billing-method')} onExit={exit} />
        )}

        {step === 'billing-method' && (
          <BillingMethodStep
            onSelect={handleBillingMethodSelect}
            onBack={handleBack}
            envApiKey={envApiKey}
            envApiKeyVar={envApiKeyVar}
          />
        )}

        {step === 'craft-login' && (
          <CraftCallbackStep
            onComplete={({ token, profile }) => handleCraftLoginComplete(token, profile)}
            onBack={handleBack}
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
            <Text color="green">Setup complete!</Text>
            <Box marginTop={1}>
              <Text dimColor>Starting Craft Agent...</Text>
            </Box>
          </Box>
        )}

        {step === 'error' && (
          <Box flexDirection="column" alignItems="center">
            <Text color="red">Setup failed</Text>
            <Box marginY={1}>
              <Text dimColor>{error}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to retry or Ctrl+C to exit</Text>
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

function getStepNumber(step: SetupStep): number {
  switch (step) {
    case 'welcome':
    case 'billing-method':
      return 1;
    case 'craft-login':
    case 'api-key-entry':
    case 'oauth-token-entry':
    case 'oauth-token-setup':
      return 2;
    case 'saving':
    case 'complete':
    case 'error':
      return 3;
    default:
      return 1;
  }
}

function getStepName(step: SetupStep): string {
  switch (step) {
    case 'welcome': return 'Welcome';
    case 'billing-method': return 'Choose Payment';
    case 'craft-login': return 'Sign In';
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
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onContinue, onExit }) => {
  useInput((_input, key) => {
    if (key.return) {
      onContinue();
    } else if (key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" alignItems="center">
      <Text>Let's set up your AI billing method.</Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue</Text>
      </Box>
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
      desc: 'Use your Craft subscription',
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

  useInput((_input, key) => {
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
          <Text color="green">Found {envApiKeyVar} in environment</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.id} flexDirection="column">
            <Box>
              <Text color={selected === i ? 'cyan' : undefined}>
                {selected === i ? '> ' : '  '}
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
        <Text dimColor>Use arrow keys, Enter to select, Esc to go back</Text>
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
        <Text color="cyan">{'> '}</Text>
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
        <Text dimColor>Enter to confirm, Esc to go back{hint ? ` - ${hint}` : ''}</Text>
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
  const mode: 'select' | 'no-options' = (!existingToken && !hasClaudeCli) ? 'no-options' : 'select';
  const [selected, setSelected] = useState(0);

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
                {selected === i ? '> ' : '  '}
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
        <Text dimColor>Use arrow keys, Enter to select, Esc to go back</Text>
      </Box>
    </Box>
  );
};
