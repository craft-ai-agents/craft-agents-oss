import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelDefinition } from '../../../../config/models.ts';
import type { ProviderDriver } from '../driver-types.ts';

export const copilotDriver: ProviderDriver = {
  provider: 'copilot',
  buildRuntime: ({ resolvedPaths }) => ({
    paths: {
      copilotCli: resolvedPaths.copilotCliPath,
      interceptor: resolvedPaths.interceptorBundlePath,
      sessionServer: resolvedPaths.sessionServerPath,
      bridgeServer: resolvedPaths.bridgeServerPath,
      node: resolvedPaths.nodeRuntimePath,
    },
  }),
  fetchModels: async ({ credentials, resolvedPaths, timeoutMs }) => {
    const accessToken = credentials.oauthAccessToken;
    if (!accessToken) {
      throw new Error('GitHub access token required to fetch Copilot models');
    }

    const { CopilotClient } = await import('@github/copilot-sdk');
    const copilotCliPath = resolvedPaths.copilotCliPath;

    const debugLines: string[] = [];
    const debugLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      debugLines.push(line);
    };

    if (copilotCliPath) {
      debugLog(`Copilot CLI path: ${copilotCliPath} (exists: ${existsSync(copilotCliPath)})`);
    }
    debugLog(`Access token: ${accessToken.substring(0, 8)}...${accessToken.substring(accessToken.length - 4)}`);

    const prevToken = process.env.COPILOT_GITHUB_TOKEN;
    process.env.COPILOT_GITHUB_TOKEN = accessToken;

    const client = new CopilotClient({
      useStdio: true,
      autoStart: true,
      logLevel: 'debug',
      ...(copilotCliPath && existsSync(copilotCliPath) ? { cliPath: copilotCliPath } : {}),
    });

    const writeDebugFile = async () => {
      try {
        const debugPath = join(homedir(), '.craft-agent', 'copilot-debug.log');
        await writeFile(debugPath, debugLines.join('\n') + '\n', 'utf-8');
      } catch { /* ignore */ }
    };

    const restoreEnv = () => {
      if (prevToken !== undefined) {
        process.env.COPILOT_GITHUB_TOKEN = prevToken;
      } else {
        delete process.env.COPILOT_GITHUB_TOKEN;
      }
    };

    let models: Array<{ id: string; name: string; supportedReasoningEfforts?: string[] }>;
    try {
      debugLog('Starting Copilot client...');
      await Promise.race([
        client.start(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
          'Copilot client failed to start within 30 seconds. Check your network connection and GitHub Copilot subscription.',
        )), timeoutMs)),
      ]);

      debugLog('Copilot client started, fetching models...');
      models = await Promise.race([
        client.listModels(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
          'Copilot model listing timed out after 30 seconds. Your GitHub token may be invalid or your Copilot plan may not support this feature.',
        )), timeoutMs)),
      ]);
      debugLog(`listModels returned ${models?.length ?? 0} models: ${models?.map(m => m.id).join(', ')}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      debugLog(`Copilot listModels FAILED: ${msg}`);
      if (stack) debugLog(`Stack: ${stack}`);
      await writeDebugFile();
      restoreEnv();
      try { await client.stop(); } catch { /* ignore cleanup errors */ }
      throw error;
    }

    try { await client.stop(); } catch { /* ignore cleanup errors */ }
    restoreEnv();
    await writeDebugFile();

    if (!models || models.length === 0) {
      throw new Error('No models returned from Copilot API. Your Copilot plan may not support this feature.');
    }

    const modelDefs: ModelDefinition[] = models.map(m => ({
      id: m.id,
      name: m.name,
      shortName: m.name,
      description: '',
      provider: 'copilot' as const,
      contextWindow: 200_000,
      supportsThinking: !!(m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0),
    }));

    return { models: modelDefs };
  },
  validateStoredConnection: async (args) => {
    const { slug, connection, credentialManager } = args;
    if (connection.authType !== 'oauth') {
      return { success: true };
    }

    const oauth = await credentialManager.getLlmOAuth(slug);
    if (!oauth?.accessToken) {
      return { success: false, error: 'Not authenticated. Please sign in with GitHub.' };
    }

    try {
      await copilotDriver.fetchModels!({
        connection,
        credentials: { oauthAccessToken: oauth.accessToken },
        hostRuntime: args.hostRuntime,
        resolvedPaths: args.resolvedPaths,
        timeoutMs: 30_000,
      });
      return { success: true, shouldRefreshModels: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to load Copilot models: ${msg}` };
    }
  },
};
