import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import crypto from 'crypto';
import { createCallbackServer } from '../../../auth/callback-server';
import { CraftApi } from '../../../clients/craftApi';
import { CraftCallbackStep } from './CraftCallbackStep';
import { CraftSpaceSelector } from './CraftSpaceSelector';

interface CraftAuthProps {
  onComplete: (craftMcpUrl: string) => void;
  onBack: () => void;
}

export const CraftAuth: React.FC<CraftAuthProps> = ({ onComplete, onBack }) => {
  let [token, setToken] = useState<string | null>();

  if (!token) {
    return <CraftCallbackStep onComplete={data => setToken(data.token)} onBack={onBack} />;
  }
  return <CraftSpaceSelector token={token} onComplete={onComplete} onBack={onBack} />;
};
