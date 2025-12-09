import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import crypto from 'crypto';
import { createCallbackServer } from '../../../auth/callback-server';
import { CraftApi } from '../../../clients/craftApi';

export interface CraftCallbackStepProps {
  onComplete: (params: { token: string }) => void;
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
  const domain = 'beta.craft.do';
  const url = `http://${domain}/login?platform=${encodeURIComponent(platform)}&code_challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  return { url, callbackUrl, callbackServer, codeVerifier, state };
}

export const CraftCallbackStep: React.FC<CraftCallbackStepProps> = ({ onComplete, onBack }) => {
  useInput((_, key) => {
    if (key.escape) {
      onBack();
    }
  });
  let [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { url, callbackUrl, callbackServer, state, codeVerifier } = await callback();
      setUrl(url);
      const payload = await callbackServer.promise;
      const callbackState = payload.query.state;
      const callbackCode = payload.query.code;
      if (callbackState !== state) {
        throw new Error('State mismatch');
      }
      if (!callbackCode) {
        throw new Error('No code received');
      }
      console.log(payload);
      const craftApi = new CraftApi('https://api.craft.do');
      const token = await craftApi.exchangeCodeForToken({ code: callbackCode, redirectUri: callbackUrl, codeVerifier });
      onComplete({ token });
    })();
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>Authorize with Craft</Text>
      <Box marginY={1}>
        {url && <Text dimColor>URL: {url}</Text>}
        {!url && <Text dimColor>Loading...</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    </Box>
  );
};