import { describe, expect, it } from 'bun:test';
import { piDriver } from './pi.ts';
import type { DriverBuildArgs } from '../driver-types.ts';

describe('Pi search runtime configuration', () => {
  it('hands the saved selection to Pi independently of LLM credentials', () => {
    const args = {
      context: { connection: { searchProvider: 'parallel', piAuthProvider: 'openai' } },
      resolvedPaths: {},
    } as unknown as DriverBuildArgs;
    expect(piDriver.buildRuntime(args)).toMatchObject({ searchProvider: 'parallel', piAuthProvider: 'openai' });
  });

  it('keeps old connections automatic and carries an explicit reset', () => {
    const args = { context: { connection: {} }, resolvedPaths: {} } as unknown as DriverBuildArgs;
    expect(piDriver.buildRuntime(args).searchProvider).toBeUndefined();
    args.context.connection!.searchProvider = 'auto';
    expect(piDriver.buildRuntime(args).searchProvider).toBe('auto');
  });
});
