import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import crypto from 'crypto';
import open from 'open';
import { createCallbackServer } from '@craft-agent/shared/auth';
import { CraftApi, type ProfileResponse } from '@craft-agent/shared/clients';
import { AnimatedSpinner } from '../Spinner';
import { debug } from '@craft-agent/shared/utils';
import { checkSubscription } from '@craft-agent/shared/subscription';
import { getCredentialManager } from '@craft-agent/shared/credentials';

// Re-export ProfileResponse as CraftProfile for backwards compatibility
export type CraftProfile = ProfileResponse;

export interface CraftCallbackStepProps {
  onComplete: (params: { token: string; profile: CraftProfile }) => void;
  onBack: () => void;
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url');

  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

const callback = async () => {
  const callbackServer = await createCallbackServer();
  const { codeVerifier, codeChallenge } = generatePKCE();
  const callbackUrl = `${callbackServer.url}/callback`;
  const state = generateState();

  const platform = 'chaps';
  const domain = 'docs.craft.do';
  const url = `http://${domain}/login?platform=${encodeURIComponent(platform)}&code_challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  return { url, callbackUrl, callbackServer, codeVerifier, state };
};

type AuthStatus = 'initializing' | 'ready' | 'waiting' | 'checking-subscription' | 'blocked' | 'error';

export const CraftCallbackStep: React.FC<CraftCallbackStepProps> = ({ onComplete, onBack }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  // Store auth result for subscription retry
  const authResultRef = useRef<{ token: string; profile: CraftProfile } | null>(null);
  const callbackDataRef = useRef<{
    callbackUrl: string;
    callbackServer: Awaited<ReturnType<typeof createCallbackServer>>;
    state: string;
    codeVerifier: string;
  } | null>(null);

  // Open browser with the auth URL
  const openBrowser = useCallback(async () => {
    if (!url) return;
    setStatus('waiting');
    try {
      await open(url);
    } catch {
      // Browser open failed, but user can still copy URL manually
    }
  }, [url]);

  // Open subscribe page
  const openSubscribePage = useCallback(async () => {
    if (!subscribeUrl) return;
    try {
      await open(subscribeUrl);
    } catch {
      // Browser open failed, user can copy URL manually
    }
  }, [subscribeUrl]);

  // Check subscription and complete if paid
  const checkAndComplete = useCallback(async () => {
    const authResult = authResultRef.current;
    if (!authResult) return;

    setStatus('checking-subscription');
    const subUrl = await checkSubscription(authResult.profile);
    if (subUrl) {
      setSubscribeUrl(subUrl);
      setStatus('blocked');
    } else {
      onComplete(authResult);
    }
  }, [onComplete]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    // Press Enter or 'o' to open browser (ready state)
    if ((key.return || input === 'o') && url && status === 'ready') {
      openBrowser();
    }
    // Blocked state: Enter to open subscribe page, R to retry check
    if (status === 'blocked') {
      if (key.return) {
        openSubscribePage();
      } else if (input === 'r' || input === 'R') {
        checkAndComplete();
      }
    }
  });

  // Initialize the callback server and URL
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { url, callbackUrl, callbackServer, state, codeVerifier } = await callback();
        if (cancelled) return;
        
        callbackDataRef.current = { callbackUrl, callbackServer, state, codeVerifier };
        setUrl(url);
        setStatus('ready');

        // Wait for callback
        const payload = await callbackServer.promise;
        if (cancelled) return;

        const callbackState = payload.query.state;
        const callbackCode = payload.query.code;
        
        if (callbackState !== state) {
          setError('State mismatch - possible security issue');
          setStatus('error');
          return;
        }
        if (!callbackCode) {
          setError('No authorization code received');
          setStatus('error');
          return;
        }
        
        const craftApi = new CraftApi();
        debug('[CraftCallbackStep] exchanging code for token:', { code: callbackCode.substring(0, 10) + '...', redirectUri: callbackUrl, codeVerifier: codeVerifier.substring(0, 10) + '...' });
        const token = await craftApi.exchangeCodeForToken({ code: callbackCode, redirectUri: callbackUrl, codeVerifier });

        // Fetch profile to get spaces and teams for categorization
        const profile = await craftApi.getProfile(token);
        const manager = getCredentialManager();
        await manager.setCraftOAuth(token);
        
        // Store auth result and check subscription
        authResultRef.current = { token, profile };
        setStatus('checking-subscription');
        const subUrl = await checkSubscription(profile);
        if (cancelled) return;
        
        if (subUrl) {
          setSubscribeUrl(subUrl);
          setStatus('blocked');
        } else {
          onComplete({ token, profile });
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column">
      {/* Status-based content */}
      {status === 'initializing' && (
        <Box marginY={1} justifyContent="center">
          <AnimatedSpinner />
          <Text> Setting up authorization...</Text>
        </Box>
      )}

      {status === 'ready' && (
        <Box flexDirection="column" alignItems="center">
          <Text>Press <Text bold color="cyan">Enter</Text> to open your browser and sign in.</Text>
          <Box marginTop={1}>
            <Text dimColor>You'll be redirected back automatically.</Text>
          </Box>
        </Box>
      )}

      {status === 'waiting' && (
        <Box flexDirection="column" alignItems="center">
          <Box>
            <AnimatedSpinner />
            <Text> Waiting for authorization...</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Complete sign-in in your browser.</Text>
          </Box>
        </Box>
      )}

      {status === 'checking-subscription' && (
        <Box flexDirection="column" alignItems="center">
          <Box>
            <AnimatedSpinner />
            <Text> Checking subscription...</Text>
          </Box>
        </Box>
      )}

      {status === 'blocked' && (
        <Box flexDirection="column" alignItems="center">
          <Text color="yellow">⚠ Subscription Required</Text>
          <Box marginY={1} flexDirection="column" alignItems="center">
            <Text>A paid Craft subscription is required to use Craft Agent.</Text>
            {subscribeUrl && (
              <Box marginTop={1}>
                <Text dimColor>{subscribeUrl}</Text>
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↵ open browser • R check again • Esc back</Text>
          </Box>
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column" alignItems="center">
          <Text color="red">✗ {error}</Text>
          <Box marginTop={1}>
            <Text dimColor>Press Esc to go back and try again.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
