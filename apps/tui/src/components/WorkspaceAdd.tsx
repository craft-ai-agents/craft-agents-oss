import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { addWorkspace, getWorkspaces, type Workspace, type OAuthCredentials, type McpAuthType } from '@craft-agent/shared/config';
import { CraftOAuth, getMcpBaseUrl } from '@craft-agent/shared/auth';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { validateMcpConnection, getValidationErrorMessage } from '@craft-agent/shared/mcp';
import { validateMcpUrl } from '@craft-agent/shared/validation';
import { TextInput } from './TextInput.tsx';
import { AnimatedSpinner } from './Spinner.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { CraftSpaceSelector, McpLinkSelector, type McpLink } from './craftAuth/CraftSpaceSelector.tsx';
import { CraftApi } from '@craft-agent/shared/clients';
import type { CraftProfile } from './craftAuth/CraftCallbackStep.tsx';
import type { AgentError, RecoveryAction } from '@craft-agent/shared/agent';

type AddStep =
  // New steps for Craft space selection
  | 'choose-source'      // Choose between Craft spaces or manual URL
  | 'loading-spaces'     // Fetching user's Craft spaces
  | 'select-space'       // Show available Craft spaces
  | 'loading-links'      // Fetching MCP links for selected space
  | 'select-mcp-link'    // Select existing MCP link or create new
  | 'creating-link'      // Creating new MCP link
  // Existing steps (manual URL flow)
  | 'name' | 'url' | 'validating-url' | 'checking-auth' | 'no-oauth-options' | 'oauth-auth' | 'bearer-token' | 'validating' | 'complete' | 'error';

export interface WorkspaceAddProps {
  onComplete: (workspace: Workspace) => void;
  onCancel: () => void;
  /** Handler for error banner actions (credits, settings, etc.) */
  onErrorAction?: (action: RecoveryAction) => void;
}

export const WorkspaceAdd: React.FC<WorkspaceAddProps> = ({ onComplete, onCancel, onErrorAction }) => {
  // Craft auth state (for space selection flow)
  const [hasCraftAuth, setHasCraftAuth] = useState<boolean | null>(null); // null = checking
  const [craftToken, setCraftToken] = useState<string | null>(null);
  const [craftProfile, setCraftProfile] = useState<CraftProfile | null>(null);
  const [availableSpaces, setAvailableSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSpace, setSelectedSpace] = useState<{ id: string; name: string } | null>(null);
  const [mcpLinks, setMcpLinks] = useState<McpLink[]>([]);
  const [spaceError, setSpaceError] = useState<string | null>(null);

  // Start with choose-source if we might have Craft auth, otherwise name
  const [step, setStep] = useState<AddStep>('choose-source');
  const [name, setName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [oauthStatus, setOauthStatus] = useState('');
  const [oauthResult, setOauthResult] = useState<OAuthCredentials | null>(null);
  const [isPublicServer, setIsPublicServer] = useState(false);
  const [bearerToken, setBearerToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [typedError, setTypedError] = useState<AgentError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<{ oauth: OAuthCredentials | null; isPublic: boolean; token?: string } | null>(null);
  const [oauthClient, setOauthClient] = useState<CraftOAuth | null>(null);

  // Single CraftApi instance (stateless, reusable across effects)
  const craftApi = useMemo(() => new CraftApi(), []);

  // Check for Craft OAuth availability on mount
  useEffect(() => {
    const checkCraftAuth = async () => {
      try {
        const manager = getCredentialManager();
        const craftOAuth = await manager.getCraftOAuth();
        if (craftOAuth) {
          setCraftToken(craftOAuth);
          setHasCraftAuth(true);
        } else {
          setHasCraftAuth(false);
          // No Craft auth - go directly to manual URL flow
          setStep('name');
        }
      } catch {
        setHasCraftAuth(false);
        setStep('name');
      }
    };
    checkCraftAuth();
  }, []);

  // Handle Ctrl+C and Escape for steps without TextInput
  // (name, url, bearer-token steps use TextInput.onCancel)
  useInput((input, key) => {
    const textInputSteps = ['name', 'url', 'bearer-token'];
    if (textInputSteps.includes(step)) return;

    // Handle validation step retry/back
    if (step === 'validating' && validationError && pendingAuth) {
      if (key.return) {
        // Retry validation with same credentials
        saveWorkspace(pendingAuth.oauth, pendingAuth.isPublic, pendingAuth.token);
      } else if (key.escape) {
        // Go back to URL step
        setValidationError(null);
        setPendingAuth(null);
        setStep('url');
      }
      return;
    }

    if ((key.ctrl && input === 'c') || key.escape) {
      // Cancel OAuth flow if in progress
      if (oauthClient) {
        oauthClient.cancel();
        setOauthClient(null);
      }
      onCancel();
    }
  });

  // Handle choosing between Craft spaces and manual URL
  const handleChooseSource = useCallback((source: 'craft' | 'manual') => {
    if (source === 'craft') {
      setStep('loading-spaces');
    } else {
      setStep('name');
    }
  }, []);

  // Fetch and filter Craft spaces when entering loading-spaces step
  useEffect(() => {
    if (step !== 'loading-spaces' || !craftToken) return;

    let cancelled = false;

    const fetchSpaces = async () => {
      try {
        const profile = await craftApi.getProfile(craftToken);

        if (cancelled) return;

        // Save profile for CraftSpaceSelector (needed for categorization)
        setCraftProfile(profile);

        // Get existing workspace MCP URLs to filter out already-connected spaces
        const existingUrls = getWorkspaces().map(w => w.mcpUrl);

        // Fetch links for all spaces in parallel (much faster than sequential)
        const spacesWithLinks = await Promise.all(
          profile.spaces.map(async (space) => {
            try {
              const links = await craftApi.getWorkflowLinks({ authToken: craftToken, spaceId: space.id });
              const mcpLinks = links.filter(
                (l: { type: string; enabled: boolean; urls?: { mcp?: string } }) =>
                  l.type === 'mcp' && l.enabled && l.urls?.mcp
              );

              // Check if any of this space's MCP links are already used
              const alreadyConnected = mcpLinks.some((link: { linkId: string }) =>
                existingUrls.some(url => url.includes(link.linkId))
              );

              return { id: space.id, name: space.name, hasConnection: alreadyConnected };
            } catch {
              // If we can't fetch links for a space, include it anyway
              return { id: space.id, name: space.name, hasConnection: false };
            }
          })
        );

        if (cancelled) return;

        // Filter to only unconnected spaces
        const unconnectedSpaces = spacesWithLinks
          .filter(s => !s.hasConnection)
          .map(s => ({ id: s.id, name: s.name }));

        if (unconnectedSpaces.length === 0) {
          // All spaces connected - show error and offer manual URL
          setSpaceError('All your Craft spaces are already connected. You can add a workspace using a custom MCP URL.');
          setStep('choose-source');
        } else {
          setAvailableSpaces(unconnectedSpaces);
          setStep('select-space');
        }
      } catch (err) {
        if (cancelled) return;
        setSpaceError(err instanceof Error ? err.message : 'Failed to fetch spaces');
        setStep('choose-source');
      }
    };

    fetchSpaces();

    return () => {
      cancelled = true;
    };
  }, [step, craftToken]);

  // Handle space selection
  const handleSpaceSelect = useCallback((spaceId: string, spaceName: string) => {
    setSelectedSpace({ id: spaceId, name: spaceName });
    setName(spaceName); // Pre-populate name with space name
    setStep('loading-links');
  }, []);

  // Fetch MCP links for selected space
  useEffect(() => {
    if (step !== 'loading-links' || !craftToken || !selectedSpace) return;

    let cancelled = false;

    const fetchLinks = async () => {
      try {
        const links = await craftApi.getWorkflowLinks({
          authToken: craftToken,
          spaceId: selectedSpace.id,
        });

        if (cancelled) return;

        // Filter to enabled MCP links with URLs
        const mcpLinksForSpace: McpLink[] = links
          .filter(l => l.type === 'mcp' && l.enabled && l.urls?.mcp)
          .map(l => ({
            name: l.name,
            linkId: l.linkId,
            mcpUrl: l.urls.mcp!,
          }));

        if (mcpLinksForSpace.length === 0) {
          // No existing links - auto-create one
          setStep('creating-link');
        } else if (mcpLinksForSpace.length === 1 && mcpLinksForSpace[0]) {
          // Single link - use it directly
          setMcpUrl(mcpLinksForSpace[0].mcpUrl);
          setStep('checking-auth');
        } else {
          // Multiple links - let user choose
          setMcpLinks(mcpLinksForSpace);
          setStep('select-mcp-link');
        }
      } catch (err) {
        if (cancelled) return;
        setSpaceError(err instanceof Error ? err.message : 'Failed to fetch MCP links');
        setStep('select-space');
      }
    };

    fetchLinks();

    return () => {
      cancelled = true;
    };
  }, [step, craftToken, selectedSpace]);

  // Handle MCP link selection
  const handleMcpLinkSelect = useCallback((url: string) => {
    setMcpUrl(url);
    setStep('checking-auth');
  }, []);

  // Handle creating new MCP link
  const handleCreateMcpLink = useCallback(() => {
    setStep('creating-link');
  }, []);

  // Create new MCP link
  useEffect(() => {
    if (step !== 'creating-link' || !craftToken || !selectedSpace) return;

    let cancelled = false;

    const createLink = async () => {
      try {
        const newLink = await craftApi.createSpaceWorkflowLink({
          authToken: craftToken,
          spaceId: selectedSpace.id,
          name: 'Craft Agent MCP',
          type: 'mcp',
          scope: 'fullSpace',
        });

        if (cancelled) return;

        if (newLink.urls?.mcp) {
          setMcpUrl(newLink.urls.mcp);
          setStep('checking-auth');
        } else {
          setSpaceError('Created link but no MCP URL returned');
          setStep('select-space');
        }
      } catch (err) {
        if (cancelled) return;
        setSpaceError(err instanceof Error ? err.message : 'Failed to create MCP link');
        setStep('select-space');
      }
    };

    createLink();

    return () => {
      cancelled = true;
    };
  }, [step, craftToken, selectedSpace]);

  const handleName = useCallback((value: string) => {
    if (!value.trim()) return;
    setName(value.trim());
    setStep('url');
  }, []);

  const handleMcpUrl = useCallback((value: string) => {
    if (!value.trim()) return;
    setMcpUrl(value.trim());
    setStep('validating-url');
  }, []);

  // Validate URL using AI when entering validating-url step
  useEffect(() => {
    if (step !== 'validating-url' || !mcpUrl) return;

    let cancelled = false;

    const validate = async () => {
      const manager = getCredentialManager();
      const apiKey = await manager.getApiKey();
      const oauthToken = await manager.getClaudeOAuth();

      const result = await validateMcpUrl(mcpUrl, apiKey || undefined, oauthToken || undefined);

      if (cancelled) return;

      if (result.valid) {
        setStep('checking-auth');
      } else if (result.typedError) {
        // API/billing error - show ErrorBanner
        setTypedError(result.typedError);
        setError(null);
        setStep('url');
      } else {
        // Simple validation error
        setError(result.error || 'Please enter a valid Craft MCP URL (mcp.craft.do)');
        setTypedError(null);
        setStep('url');
      }
    };

    validate();

    return () => {
      cancelled = true;
    };
  }, [step, mcpUrl]);

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
        const oauthCreds: OAuthCredentials = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          clientId,
          tokenType: tokens.tokenType,
        };
        setOauthResult(oauthCreds);
        setOauthClient(null);
        // Save workspace with OAuth credentials
        saveWorkspace(oauthCreds, false);
      })
      .catch((err) => {
        // OAuth failed - offer bearer token as alternative
        setOauthStatus(err instanceof Error ? err.message : 'OAuth authentication failed');
        setOauthClient(null);
        setStep('no-oauth-options');
      });

    return () => {
      oauth.cancel();
    };
  }, [step, mcpUrl]);

  const saveWorkspace = useCallback(async (oauth: OAuthCredentials | null, isPublic: boolean, token?: string) => {
    setStep('validating');
    setValidationError(null);
    setPendingAuth({ oauth, isPublic, token });

    try {
      // Get Claude credentials from credential store for validation
      const manager = getCredentialManager();
      const claudeApiKey = await manager.getApiKey();
      const claudeOAuthToken = await manager.getClaudeOAuth();

      // Determine MCP access token for validation
      let mcpAccessToken: string | undefined;
      if (oauth) {
        mcpAccessToken = oauth.accessToken;
      } else if (token) {
        mcpAccessToken = token;
      }
      // For public servers, no token needed

      // Validate MCP connection using SDK
      const validationResult = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken,
        claudeApiKey: claudeApiKey || undefined,
        claudeOAuthToken: claudeOAuthToken || undefined,
      });

      if (!validationResult.success) {
        // Check for API/billing errors - show ErrorBanner
        if (validationResult.typedError) {
          setTypedError(validationResult.typedError);
          setValidationError(null);
          setStep('url');
          return;
        }
        // Simple validation error - show inline
        setValidationError(getValidationErrorMessage(validationResult));
        return; // Stay on validating step with error
      }

      // Validation passed - create workspace
      // Determine mcpAuthType based on auth method used
      let mcpAuthType: McpAuthType;
      if (oauth) {
        mcpAuthType = 'workspace_oauth';
      } else if (token) {
        mcpAuthType = 'workspace_bearer';
      } else {
        mcpAuthType = 'public';
      }

      const workspace = addWorkspace({
        name,
        mcpUrl,
        mcpAuthType,
      });

      // Save credentials to credential store
      if (oauth) {
        await manager.setWorkspaceOAuth(workspace.id, {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt,
          clientId: oauth.clientId,
          tokenType: oauth.tokenType,
        });
      } else if (token) {
        await manager.setWorkspaceBearer(workspace.id, token);
      }

      setPendingAuth(null);
      setStep('complete');

      // Give user a moment to see success message
      setTimeout(() => {
        onComplete(workspace);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add workspace');
      setStep('error');
    }
  }, [name, mcpUrl, onComplete]);

  const handleNoOAuthSelect = useCallback((method: 'bearer' | 'public') => {
    if (method === 'bearer') {
      setStep('bearer-token');
    } else {
      setIsPublicServer(true);
      saveWorkspace(null, true);
    }
  }, [saveWorkspace]);

  const handleBearerToken = useCallback((token: string) => {
    if (!token.trim()) return;
    saveWorkspace(null, false, token.trim());
  }, [saveWorkspace]);

  const handleRetry = useCallback(() => {
    setError(null);
    setOauthResult(null);
    setIsPublicServer(false);
    setStep('url');
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Add New Workspace</Text>
        <Text dimColor> - Step {getStepNumber(step)} of 3</Text>
      </Box>

      {/* Step content */}

      {/* Choose source: Craft spaces or manual URL */}
      {step === 'choose-source' && hasCraftAuth !== null && (
        <ChooseSourceStep
          onSelect={handleChooseSource}
          hasCraftAuth={hasCraftAuth}
          error={spaceError}
          onClearError={() => setSpaceError(null)}
        />
      )}

      {/* Loading: checking Craft auth or loading spaces */}
      {(step === 'choose-source' && hasCraftAuth === null) && (
        <Box flexDirection="column">
          <Box>
            <AnimatedSpinner />
            <Text> Checking Craft account...</Text>
          </Box>
        </Box>
      )}

      {step === 'loading-spaces' && (
        <Box flexDirection="column">
          <Box>
            <AnimatedSpinner />
            <Text> Loading your Craft spaces...</Text>
          </Box>
        </Box>
      )}

      {/* Select Craft space */}
      {step === 'select-space' && craftProfile && (
        <CraftSpaceSelector
          profile={{
            ...craftProfile,
            // Override spaces with only available (unconnected) ones
            spaces: availableSpaces,
          }}
          onSelect={handleSpaceSelect}
          onBack={() => setStep('choose-source')}
        />
      )}

      {step === 'loading-links' && (
        <Box flexDirection="column">
          <Box>
            <AnimatedSpinner />
            <Text> Loading MCP connections for {selectedSpace?.name}...</Text>
          </Box>
        </Box>
      )}

      {/* Select MCP link */}
      {step === 'select-mcp-link' && selectedSpace && (
        <McpLinkSelector
          spaceName={selectedSpace.name}
          mcpLinks={mcpLinks}
          onSelect={handleMcpLinkSelect}
          onCreateNew={handleCreateMcpLink}
          onBack={() => setStep('select-space')}
        />
      )}

      {step === 'creating-link' && (
        <Box flexDirection="column">
          <Box>
            <AnimatedSpinner />
            <Text> Creating new MCP connection...</Text>
          </Box>
        </Box>
      )}

      {step === 'name' && (
        <NameStep
          value={name}
          onChange={setName}
          onSubmit={handleName}
          onCancel={onCancel}
        />
      )}

      {step === 'url' && (
        <>
          {typedError && (
            <ErrorBanner
              error={typedError}
              onAction={(action) => {
                setTypedError(null);
                onErrorAction?.(action);
              }}
              onDismiss={() => setTypedError(null)}
            />
          )}
          <UrlStep
            value={mcpUrl}
            onChange={setMcpUrl}
            onSubmit={handleMcpUrl}
            onCancel={onCancel}
            error={error}
          />
        </>
      )}

      {step === 'validating-url' && (
        <Box flexDirection="column">
          <Box>
            <AnimatedSpinner />
            <Text> Validating URL...</Text>
          </Box>
        </Box>
      )}

      {step === 'checking-auth' && (
        <Box flexDirection="column">
          <Text>Checking server...</Text>
          <Box marginY={1}>
            <Text color="cyan">|</Text>
            <Text> {oauthStatus || 'Connecting...'}</Text>
          </Box>
        </Box>
      )}

      {step === 'no-oauth-options' && (
        <NoOAuthOptionsStep onSelect={handleNoOAuthSelect} message={oauthStatus} />
      )}

      {step === 'bearer-token' && (
        <BearerTokenStep
          value={bearerToken}
          onChange={setBearerToken}
          onSubmit={handleBearerToken}
          onCancel={onCancel}
        />
      )}

      {step === 'oauth-auth' && (
        <Box flexDirection="column">
          <Text bold>OAuth Authorization</Text>
          <Box marginY={1}>
            <Text dimColor>
              A browser window will open for you to authorize access.
            </Text>
          </Box>
          <Box marginY={1}>
            <Text color="cyan">|</Text>
            <Text> {oauthStatus}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Complete the authorization in your browser.</Text>
          </Box>
        </Box>
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
          <Text color="green" bold>Workspace added: {name}</Text>
        </Box>
      )}

      {step === 'error' && (
        <ErrorStep
          error={error}
          onRetry={handleRetry}
        />
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Press Esc to cancel</Text>
      </Box>
    </Box>
  );
};

function getStepNumber(step: AddStep): number {
  switch (step) {
    case 'choose-source':
    case 'loading-spaces':
    case 'select-space':
      return 1;
    case 'loading-links':
    case 'select-mcp-link':
    case 'creating-link':
    case 'name':
      return 2;
    case 'url':
    case 'validating-url':
      return 2;
    case 'checking-auth':
    case 'no-oauth-options':
    case 'oauth-auth':
    case 'bearer-token':
    case 'validating':
    case 'complete':
    case 'error':
      return 3;
  }
}

// Sub-components

interface NameStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const NameStep: React.FC<NameStepProps> = ({ value, onChange, onSubmit, onCancel }) => {
  return (
    <Box flexDirection="column">
      <Text>Give this workspace a friendly name:</Text>
      <Box marginY={1}>
        <Text dimColor>e.g., "Work Projects", "Personal Notes"</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="My Workspace"
        />
      </Box>
    </Box>
  );
};

interface UrlStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  error: string | null;
}

const UrlStep: React.FC<UrlStepProps> = ({ value, onChange, onSubmit, onCancel, error }) => {
  return (
    <Box flexDirection="column">
      <Text>Enter the Craft MCP server URL:</Text>
      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="https://mcp.craft.do/links/YOUR_LINK_ID"
        />
      </Box>
    </Box>
  );
};

interface ErrorStepProps {
  error: string | null;
  onRetry: () => void;
}

const ErrorStep: React.FC<ErrorStepProps> = ({ error, onRetry }) => {
  useInput((input, key) => {
    if (key.return) {
      onRetry();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="red" bold>Failed to add workspace</Text>
      <Text color="red">{error}</Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to retry</Text>
      </Box>
    </Box>
  );
};

// No OAuth options - shown when OAuth is not detected or fails
interface NoOAuthOptionsStepProps {
  onSelect: (method: 'bearer' | 'public') => void;
  message?: string;
}

const NoOAuthOptionsStep: React.FC<NoOAuthOptionsStepProps> = ({ onSelect, message }) => {
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
      <Text dimColor>Use arrow keys to select, Enter to confirm</Text>
    </Box>
  );
};

// Bearer token input step
interface BearerTokenStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const BearerTokenStep: React.FC<BearerTokenStepProps> = ({ value, onChange, onSubmit, onCancel }) => {
  return (
    <Box flexDirection="column">
      <Text>Enter your bearer token:</Text>
      <Box marginY={1}>
        <Text dimColor>The token will be sent as: Authorization: Bearer {'<token>'}</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="Paste your bearer token..."
          mask="•"
          maskReveal={{ last: 4 }}
        />
      </Box>
    </Box>
  );
};

// Choose source: Craft spaces or manual URL entry
interface ChooseSourceStepProps {
  onSelect: (source: 'craft' | 'manual') => void;
  hasCraftAuth: boolean;
  error: string | null;
  onClearError: () => void;
}

const ChooseSourceStep: React.FC<ChooseSourceStepProps> = ({ onSelect, hasCraftAuth, error, onClearError }) => {
  const [selected, setSelected] = useState(0);

  const options = hasCraftAuth
    ? [
        { label: 'Select from your Craft spaces', value: 'craft' as const },
        { label: 'Enter MCP URL manually', value: 'manual' as const },
      ]
    : [
        { label: 'Enter MCP URL manually', value: 'manual' as const },
      ];

  useInput((_, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
      if (error) onClearError();
    } else if (key.downArrow) {
      setSelected(s => Math.min(options.length - 1, s + 1));
      if (error) onClearError();
    } else if (key.return) {
      const option = options[selected];
      if (option) onSelect(option.value);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>How would you like to add a workspace?</Text>
      {error && (
        <Box marginY={1}>
          <Text color="yellow">{error}</Text>
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
      <Text dimColor>Use arrow keys to select, Enter to confirm</Text>
    </Box>
  );
};
