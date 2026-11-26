import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A Pi session's credential only goes where its connection is: a custom endpoint's key to
 * the endpoint, a provider's credential to that provider, and no session authenticates to
 * another provider with a key the process inherited. Drives src/index.ts over its JSONL
 * protocol with every request blocked after it reports its origin and credential
 * (test-fixtures/record-credentials.ts), so each test sees where the key would have gone.
 * A custom endpoint is labelled with a vendor's provider id ('openai' / 'anthropic') for
 * the Pi SDK's request format, which is what made built-in models of that vendor reachable.
 */

const serverPath = join(import.meta.dir, 'index.ts');
const recordCredentialsPath = join(import.meta.dir, 'test-fixtures', 'record-credentials.ts');
const WAIT_MS = 20_000;
const KEY = 'sk-test-endpoint-key';
const AMBIENT_KEY = 'sk-test-ambient-env-key';
const ENDPOINT_URL = 'https://llm.example.com/v1';
const ENDPOINT_ORIGIN = 'https://llm.example.com';

/** A ChatGPT-account access token: the Pi SDK reads the account id from it. */
const CODEX_TOKEN = (() => {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'RS256' })}.${part({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_test' } })}.sig`;
})();

let scratchDir: string;
let servers: Server[] = [];

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'pi-endpoint-routing-'));
  mkdirSync(join(scratchDir, 'plans'), { recursive: true });
});

afterEach(() => {
  for (const server of servers) server.stop();
  servers = [];
  rmSync(scratchDir, { recursive: true, force: true });
});

interface CredentialRequest {
  origin: string;
  credential: string;
}

class Server {
  private child: ChildProcessWithoutNullStreams;
  output = '';

  constructor(env: Record<string, string> = {}) {
    this.child = spawn(process.execPath, ['--preload', recordCredentialsPath, serverPath], {
      cwd: scratchDir,
      env: { PATH: process.env.PATH, HOME: scratchDir, TMPDIR: scratchDir, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    this.child.stderr.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    servers.push(this);
  }

  send(message: object): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Wait until the output contains `text`. */
  async waitFor(text: string): Promise<void> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      if (this.output.includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for "${text}"; output:\n${this.output.slice(-3000)}`);
  }

  /** Every request made so far, in order (where its credential went, not the model it asked for). */
  requests(): CredentialRequest[] {
    return [...this.output.matchAll(/^CREDENTIAL_REQUEST (\S+) (\S+) model=/gm)]
      .map(([, origin, credential]) => ({ origin: origin!, credential: credential! }));
  }

  stop(): void {
    this.child.kill();
  }
}

function baseInit(overrides: Record<string, unknown>) {
  return {
    type: 'init',
    apiKey: '',
    cwd: scratchDir,
    thinkingLevel: 'off',
    workspaceRootPath: scratchDir,
    sessionId: 'credential-routing-test',
    sessionPath: join(scratchDir, 'session'),
    workingDirectory: scratchDir,
    plansFolderPath: join(scratchDir, 'plans'),
    ...overrides,
  };
}

function customEndpointInit(overrides: Record<string, unknown> = {}) {
  return baseInit({
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    baseUrl: ENDPOINT_URL,
    customEndpoint: { api: 'openai-completions' },
    customModels: ['endpoint-model', 'endpoint-mini'],
    model: 'endpoint-model',
    miniModel: 'endpoint-mini',
    piAuthProvider: 'openai',
    piAuth: { provider: 'openai', credential: { type: 'api_key', key: KEY } },
    ...overrides,
  });
}

/** A connection to OpenAI itself (the OpenAI API-key preset). */
function openAiInit(overrides: Record<string, unknown> = {}) {
  return baseInit({
    providerType: 'pi',
    authType: 'api_key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    piAuthProvider: 'openai',
    piAuth: { provider: 'openai', credential: { type: 'api_key', key: KEY } },
    ...overrides,
  });
}

const anthropicCompatible = {
  customEndpoint: { api: 'anthropic-messages' },
  piAuthProvider: 'anthropic',
  piAuth: { provider: 'anthropic', credential: { type: 'api_key', key: KEY } },
};

/** Start a server, run `act`, and return the requests once the first one was made. */
async function firstRequests(
  init: object,
  act: (server: Server) => Promise<void> | void,
  env?: Record<string, string>,
): Promise<CredentialRequest[]> {
  const server = new Server(env);
  server.send(init);
  await server.waitFor('"type":"ready"');
  await act(server);
  await server.waitFor('CREDENTIAL_REQUEST ');
  return server.requests();
}

const utilityQuery = (request: Record<string, unknown> = {}) => (server: Server) => {
  server.send({ type: 'llm_query', id: 'q1', request: { prompt: 'Reply with ok', ...request } });
};

const chatPrompt = (server: Server) => {
  server.send({ type: 'prompt', id: 'p1', message: 'hi', systemPrompt: 'You are a test.' });
};

describe('custom endpoint credential routing (subprocess)', () => {
  it('sends utility queries to the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit(), utilityQuery());
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('sends chat to the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit(), chatPrompt);
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('keeps call_llm with a built-in model id on the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit(), utilityQuery({ model: 'gpt-6-astra' }));
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('keeps utility queries of an Anthropic-compatible endpoint without a mini model off Anthropic', async () => {
    const requests = await firstRequests(
      customEndpointInit({ ...anthropicCompatible, miniModel: undefined }),
      utilityQuery(),
    );
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('retries a model the endpoint rejects on endpoint models only', async () => {
    const server = new Server({ CREDENTIAL_TEST_REJECT_ORIGIN: ENDPOINT_ORIGIN });
    server.send(customEndpointInit());
    await server.waitFor('"type":"ready"');
    utilityQuery()(server);
    await server.waitFor('"type":"llm_query_result"');

    const requests = server.requests();
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.filter(request => request.origin !== ENDPOINT_ORIGIN)).toEqual([]);
  }, WAIT_MS);

  it('keeps a session model that is not in the endpoint list, but is a built-in id, on the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit({ model: 'gpt-5.5', customModels: ['endpoint-model'] }), chatPrompt);
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('never lets the Pi SDK pick its default model for an unresolvable session model', async () => {
    const requests = await firstRequests(customEndpointInit({ model: 'retired-model', customModels: ['endpoint-model'] }), chatPrompt);
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('never lets the Pi SDK pick its default model when the session has no model', async () => {
    const requests = await firstRequests(customEndpointInit({ model: '' }), chatPrompt);
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('never lets the Pi SDK pick its default model on an Anthropic-compatible endpoint', async () => {
    const requests = await firstRequests(
      customEndpointInit({ ...anthropicCompatible, model: 'retired-model', customModels: ['endpoint-model'] }),
      chatPrompt,
    );
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('keeps a runtime config update to a built-in id on the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit(), async (server) => {
      server.send({ type: 'ensure_session_ready', id: 'e1' });
      await server.waitFor('"type":"ensure_session_ready_result"');
      server.send({
        type: 'update_runtime_config',
        id: 'u1',
        model: 'gpt-5.5',
        providerType: 'pi_compat',
        authType: 'api_key_with_endpoint',
        baseUrl: ENDPOINT_URL,
        customEndpoint: { api: 'openai-completions' },
        customModels: ['endpoint-model'],
      });
      await server.waitFor('"type":"update_runtime_config_result"');
      chatPrompt(server);
    });
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('keeps set_model to a built-in id on the endpoint', async () => {
    const requests = await firstRequests(customEndpointInit(), async (server) => {
      server.send({ type: 'ensure_session_ready', id: 'e1' });
      await server.waitFor('"type":"ensure_session_ready_result"');
      server.send({ type: 'set_model', model: 'gpt-5.5' });
      await server.waitFor('[set_model] ');
      chatPrompt(server);
    });
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);
});

// A key in the environment the app was started with (or one the app put there) is not
// the connection's. The Pi SDK authenticates any provider from the environment when
// nothing is stored for it, and picks its default model from every provider that
// authenticates when the session model doesn't resolve: Anthropic's comes first.
describe('provider credential routing (subprocess)', () => {
  it('sends chat to the connection\'s provider (control)', async () => {
    const requests = await firstRequests(openAiInit(), chatPrompt, { ANTHROPIC_API_KEY: AMBIENT_KEY });
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: KEY });
  }, WAIT_MS);

  it('keeps a session whose model does not resolve on its own provider, never another vendor\'s inherited key', async () => {
    const requests = await firstRequests(openAiInit({ model: 'retired-model' }), chatPrompt, { ANTHROPIC_API_KEY: AMBIENT_KEY });
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: KEY });
  }, WAIT_MS);

  it('keeps a ChatGPT-account session whose model does not resolve on ChatGPT', async () => {
    const requests = await firstRequests(
      baseInit({
        providerType: 'pi',
        authType: 'oauth',
        model: 'retired-model',
        piAuthProvider: 'openai-codex',
        piAuth: { provider: 'openai-codex', credential: { type: 'api_key', key: CODEX_TOKEN } },
      }),
      chatPrompt,
      { ANTHROPIC_API_KEY: AMBIENT_KEY },
    );
    expect(requests[0]).toEqual({ origin: 'https://chatgpt.com', credential: CODEX_TOKEN });
  }, WAIT_MS);

  // `environment` auth (Bedrock with an AWS profile, a key in the shell) has no credential
  // to send, so the connection's provider comes alone; the environment is the user's
  // choice for that provider only.
  it('authenticates an environment-auth connection to its own provider only', async () => {
    const requests = await firstRequests(
      openAiInit({ authType: 'environment', piAuth: undefined, model: 'retired-model' }),
      chatPrompt,
      { OPENAI_API_KEY: AMBIENT_KEY, ANTHROPIC_API_KEY: 'sk-test-other-vendor-key' },
    );
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: AMBIENT_KEY });
  }, WAIT_MS);

  // The OpenAI EU/US presets: OpenAI's models at the region's API, where an EU/US data
  // residency project's key belongs.
  it.each([
    ['openai-eu', 'https://eu.api.openai.com'],
    ['openai-us', 'https://us.api.openai.com'],
  ] as const)('sends chat of the %s preset to its regional API', async (provider, origin) => {
    const requests = await firstRequests(
      openAiInit({ baseUrl: `${origin}/v1`, piAuthProvider: provider, piAuth: { provider, credential: { type: 'api_key', key: KEY } } }),
      chatPrompt,
      { ANTHROPIC_API_KEY: AMBIENT_KEY, OPENAI_API_KEY: 'sk-test-other-openai-key' },
    );
    expect(requests[0]).toEqual({ origin, credential: KEY });
  }, WAIT_MS);

  // Connection setup labels custom endpoints 'openai'/'anthropic' only, but a stored config may say otherwise.
  it('keeps a custom endpoint labelled with a regional preset on the endpoint', async () => {
    const requests = await firstRequests(
      customEndpointInit({ piAuthProvider: 'openai-eu', piAuth: { provider: 'openai-eu', credential: { type: 'api_key', key: KEY } } }),
      chatPrompt,
    );
    expect(requests[0]).toEqual({ origin: ENDPOINT_ORIGIN, credential: KEY });
  }, WAIT_MS);

  it('pins a regional preset to its region whatever base URL is stored', async () => {
    const requests = await firstRequests(
      openAiInit({ piAuthProvider: 'openai-eu', piAuth: { provider: 'openai-eu', credential: { type: 'api_key', key: KEY } } }),
      chatPrompt,
    );
    expect(requests[0]).toEqual({ origin: 'https://eu.api.openai.com', credential: KEY });
  }, WAIT_MS);

  it('keeps call_llm with another vendor\'s model on the connection\'s provider', async () => {
    const requests = await firstRequests(
      openAiInit({ authType: 'environment', piAuth: undefined }),
      utilityQuery({ model: 'claude-haiku-4-5' }),
      { OPENAI_API_KEY: AMBIENT_KEY, ANTHROPIC_API_KEY: 'sk-test-other-vendor-key' },
    );
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: AMBIENT_KEY });
  }, WAIT_MS);
});
