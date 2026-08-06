/**
 * Regression: saveSourceConfig should clean up orphan credentials when an API
 * source is set to authType:'none'.
 *
 * Background: getCredentialId() maps 'none', 'header', and 'query' authTypes to
 * the same source_apikey slot. Flipping a source from 'header' to 'none' leaves
 * the original credential value addressable under the source's slot, which can
 * silently override defaultHeaders on subsequent server builds.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { saveSourceConfig, loadSourceConfig } from '../storage.ts';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { FolderSourceConfig, LoadedSource } from '../types.ts';

type DeleteCall = { type: string; workspaceId: string; sourceId: string };

let workspaceRoot: string;
let deleteCalls: DeleteCall[] = [];
let deleteShouldThrow = false;
let deleteReturnValue = true;
let deleteSpy: { mockRestore: () => void } | null = null;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'save-source-config-orphan-'));
  deleteCalls = [];
  deleteShouldThrow = false;
  deleteReturnValue = true;

  deleteSpy = spyOn(SourceCredentialManager.prototype, 'deleteSync').mockImplementation((source: LoadedSource) => {
    const credentialId = new SourceCredentialManager().getCredentialId(source);
    deleteCalls.push({
      type: credentialId.type,
      workspaceId: credentialId.workspaceId!,
      sourceId: credentialId.sourceId!,
    });
    if (deleteShouldThrow) throw new Error('encrypted store unavailable');
    return deleteReturnValue;
  });
});

afterEach(() => {
  deleteSpy?.mockRestore();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function apiConfig(overrides: Partial<FolderSourceConfig['api']> = {}): FolderSourceConfig {
  return {
    id: 'picnic_abcd',
    name: 'Picnic',
    slug: 'picnic',
    enabled: true,
    provider: 'custom',
    type: 'api',
    api: {
      baseUrl: 'https://example.com',
      authType: 'none',
      ...overrides,
    },
  };
}

function loadedApiSource(config: FolderSourceConfig): LoadedSource {
  return {
    config,
    guide: null,
    folderPath: join(workspaceRoot, 'sources', config.slug),
    workspaceRootPath: workspaceRoot,
    workspaceId: basename(workspaceRoot),
  };
}

describe('saveSourceConfig orphan credential cleanup', () => {
  test("deletes the source_apikey slot when an API source is saved with authType:'none'", () => {
    saveSourceConfig(workspaceRoot, apiConfig({
      authType: 'none',
      defaultHeaders: { Cookie: '_oauth2_proxy=foo; __cf_bm=bar' },
    }));

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.type).toBe('source_apikey');
    expect(deleteCalls[0]!.sourceId).toBe('picnic');
    expect(deleteCalls[0]!.workspaceId).toMatch(/^save-source-config-orphan-/);
  });

  test("does NOT delete the credential when API source is saved with authType:'header'", () => {
    saveSourceConfig(workspaceRoot, apiConfig({ authType: 'header', headerName: 'Cookie' }));
    expect(deleteCalls).toHaveLength(0);
  });

  test("does NOT delete the credential when API source is saved with authType:'bearer'", () => {
    saveSourceConfig(workspaceRoot, apiConfig({ authType: 'bearer' }));
    expect(deleteCalls).toHaveLength(0);
  });

  test("does NOT delete the credential for MCP sources with mcp.authType:'none'", () => {
    const config: FolderSourceConfig = {
      id: 'mcp_abcd',
      name: 'Some MCP',
      slug: 'some-mcp',
      enabled: true,
      provider: 'custom',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    };

    saveSourceConfig(workspaceRoot, config);

    expect(deleteCalls).toHaveLength(0);
  });

  test("saving authType:'none' when nothing is stored is a safe no-op", () => {
    deleteReturnValue = false; // simulate "nothing to delete"
    expect(() => saveSourceConfig(workspaceRoot, apiConfig({ authType: 'none' }))).not.toThrow();
    expect(deleteCalls).toHaveLength(1); // attempt made; backend reports no-op
  });

  test("authType:'none' sources do not resolve the shared source_apikey slot even before cleanup finishes", async () => {
    const manager = new SourceCredentialManager();
    const idSpy = spyOn(manager, 'getCredentialId');

    const credential = await manager.load(loadedApiSource(apiConfig({ authType: 'none' })));

    expect(credential).toBeNull();
    expect(idSpy).not.toHaveBeenCalled();
    idSpy.mockRestore();
  });

  test('credential delete failure does NOT prevent the config file from being written', () => {
    deleteShouldThrow = true;

    expect(() => saveSourceConfig(workspaceRoot, apiConfig({ authType: 'none' }))).not.toThrow();

    const loaded = loadSourceConfig(workspaceRoot, 'picnic');
    expect(loaded?.api?.authType).toBe('none');
    expect(existsSync(join(workspaceRoot, 'sources', 'picnic', 'config.json'))).toBe(true);
  });
});
