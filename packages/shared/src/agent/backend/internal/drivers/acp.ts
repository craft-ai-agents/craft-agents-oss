/**
 * ACP Provider Driver
 *
 * Minimal ProviderDriver implementation for the ACP (Agent Client Protocol) backend.
 *
 * ACP agents:
 * - Do not have a fixed runtime payload (transport is injected at construction time)
 * - Support model fetching via a probe initialize+session/new call
 * - Do not require host runtime initialization
 *
 * The actual AcpAgent is instantiated via createBackendWithTransport() in factory.ts,
 * not through the generic createBackend() path (which requires a transport parameter
 * that isn't available in the generic BackendConfig).
 */

import type { ProviderDriver } from '../driver-types.ts';
import { StdioAcpTransport, _buildSafeEnv } from '../../../acp-transport.ts';
import type { ModelDefinition } from '../../../../config/models.ts';

export const acpDriver: ProviderDriver = {
  provider: 'acp',

  buildRuntime(_args) {
    // ACP has no runtime payload — transport is provided via constructor injection
    return {};
  },

  /**
   * Fetch available models by probing the ACP server with initialize + session/new.
   * Models are returned in the session/new response (models.availableModels or configOptions[category=model]).
   * The probe transport is disposed immediately after.
   */
  async fetchModels({ connection, timeoutMs }) {
    const acpCommand = (connection as any).acpCommand as string[] | undefined;
    const acpEnv = (connection as any).acpEnv as Record<string, string> | undefined;

    if (!acpCommand?.length) {
      return { models: [] };
    }

    const transport = new StdioAcpTransport(acpCommand, acpEnv);

    try {
      // Use a shorter timeout for the ACP probe (initialize + session/new) so that
      // agents which never respond (e.g. Cursor `agent acp`) fail fast and let the
      // `--list-models` fallback run within the overall timeoutMs budget.
      const probeTimeoutMs = Math.min(timeoutMs, 5_000);
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ACP fetchModels timeout')), probeTimeoutMs)
      );

      const probe = async () => {
        await transport.sendRequest('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          clientInfo: { name: 'craft-agents', version: '1.0.0' },
        });

        const result = await transport.sendRequest('session/new', {
          cwd: (typeof process !== 'undefined' ? process.cwd() : undefined),
          mcpServers: [],
        }) as {
          sessionId: string;
          models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> };
          configOptions?: Array<{ id: string; category?: string; currentValue?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
        };

        return result;
      };

      const result = await Promise.race([probe(), timer]);
      const models = extractModels(result);

      // Some ACP servers (e.g. Cursor `agent acp`) don't return model lists via
      // session/new. Fall back to running `<bin> --list-models` to discover them.
      if (models.length === 0) {
        const listModels = await _fetchCursorModels(acpCommand, acpEnv, timeoutMs);
        if (listModels.length > 0) return { models: listModels };

        // Final fallback: a "Default" entry so the UI can still start a chat
        models.push({
          id: 'default',
          name: 'Default',
          shortName: 'Default',
          description: 'Agent-managed model',
          provider: 'acp' as never,
          contextWindow: 0,
        });
      }

      return { models };
    } catch {
      // probe() failed or timed out — still try `--list-models` before giving up.
      // This is the common path for Cursor `agent acp` which never responds to session/new.
      try {
        const listModels = await _fetchCursorModels(acpCommand, acpEnv, timeoutMs);
        if (listModels.length > 0) return { models: listModels };
      } catch {
        // ignore
      }
      return { models: [] };
    } finally {
      await transport.dispose().catch(() => {});
    }
  },
};

function extractModels(result: {
  models?: { availableModels?: Array<{ modelId: string; name: string; description?: string }> };
  configOptions?: Array<{ id: string; category?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
}): ModelDefinition[] {
  // New format: configOptions[category=model]
  if (result.configOptions) {
    const modelOpt = result.configOptions.find(o => o.category === 'model' || o.id === 'model');
    if (modelOpt?.options?.length) {
      return modelOpt.options.map(o => ({
        id: o.value,
        name: o.name,
        shortName: o.name,
        description: o.description ?? '',
        provider: 'acp' as never,
        contextWindow: 0,
      }));
    }
  }
  // Legacy format: models.availableModels
  if (result.models?.availableModels?.length) {
    return result.models.availableModels.map(m => ({
      id: m.modelId,
      name: m.name,
      shortName: m.name,
      description: m.description ?? '',
      provider: 'acp' as never,
      contextWindow: 0,
    }));
  }
  return [];
}

/**
 * Fetch models from Cursor Agent CLI using `cursor agent models` (or `--list-models`).
 * Falls back to a single "Default" entry if the command fails or times out.
 */
async function _fetchCursorModels(
  acpCommand: string[],
  acpEnv?: Record<string, string>,
  timeoutMs = 10000,
): Promise<ModelDefinition[]> {
  try {
    const { execFile } = require('node:child_process') as typeof import('node:child_process');

    // Build the correct --list-models command.
    // User may configure: ['cursor-agent'], ['cursor', 'agent'], ['cursor-agent', 'acp'], etc.
    // We need: cursor-agent --list-models (or cursor agent --list-models)
    const baseBin = acpCommand[0];
    if (!baseBin) throw new Error('empty command');

    // Determine args: skip 'acp' subcommand if present, keep 'agent' if separate
    const args = acpCommand.slice(1).filter(a => a.toLowerCase() !== 'acp');
    args.push('--list-models');

    const result = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      execFile(baseBin, args, {
        env: _buildSafeEnv(acpEnv),
        timeout: timeoutMs,
      }, (err, stdout) => {
        clearTimeout(timer);
        if (err) { reject(err); return; }
        resolve(stdout);
      });
    });

    // Parse output: `cursor agent --list-models` outputs lines in format:
    //   id - Display Name  (current, default)
    // Strip ANSI escape codes first, then parse each model line.
    const clean = result.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const models: ModelDefinition[] = [];
    for (const line of lines) {
      // Match lines like: "claude-4.6-sonnet-medium - Sonnet 4.6 1M" or "auto - Auto"
      const match = line.match(/^(\S+)\s+-\s+(.+?)(?:\s+\(.*\))?$/);
      if (!match) continue;
      const [, id, displayName] = match;
      if (!id || !displayName) continue;
      models.push({
        id,
        name: displayName.trim(),
        shortName: displayName.trim(),
        description: '',
        provider: 'acp' as never,
        contextWindow: 0,
      });
    }

    if (models.length > 0) return models;
  } catch {
    // Fall through to default
  }

  // Fallback: single Default entry so the UI can start a chat
  return [{
    id: 'default',
    name: 'Cursor Agent',
    shortName: 'Cursor',
    description: 'Cursor Agent (model managed by Cursor)',
    provider: 'acp' as never,
    contextWindow: 0,
  }];
}
