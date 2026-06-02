import { describe, it, expect } from 'bun:test';
import { handleUpdatePreferences, type UpdatePreferencesArgs } from './update-preferences.ts';
import type { SessionToolContext } from '../context.ts';

type WriteRecord = Record<string, unknown>;

function createCtx(): { ctx: SessionToolContext; writes: WriteRecord[] } {
  const writes: WriteRecord[] = [];
  const ctx = {
    updatePreferences: (updates: Record<string, unknown>) => {
      writes.push(updates);
    },
  } as unknown as SessionToolContext;
  return { ctx, writes };
}

describe('handleUpdatePreferences', () => {
  it('persists known fields (name, timezone)', async () => {
    const { ctx, writes } = createCtx();
    const result = await handleUpdatePreferences(ctx, { name: 'Alice', timezone: 'Europe/Budapest' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ name: 'Alice', timezone: 'Europe/Budapest' });
    expect(result.content[0]?.text).toContain('name');
    expect(result.content[0]?.text).toContain('timezone');
  });

  it('merges city/region/country into a single location object', async () => {
    const { ctx, writes } = createCtx();
    await handleUpdatePreferences(ctx, { city: 'Budapest', country: 'Hungary' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ location: { city: 'Budapest', country: 'Hungary' } });
  });

  it('ignores legacy `language` argument (not in the documented schema)', async () => {
    const { ctx, writes } = createCtx();
    await handleUpdatePreferences(ctx, { language: 'Hungarian' } as unknown as UpdatePreferencesArgs);
    expect(writes).toHaveLength(0);
  });

  it('ignores `uiLanguage` argument (internal field — not user-editable here)', async () => {
    const { ctx, writes } = createCtx();
    await handleUpdatePreferences(ctx, { uiLanguage: 'hu' } as unknown as UpdatePreferencesArgs);
    expect(writes).toHaveLength(0);
  });

  it('responds gracefully when no recognised fields are provided', async () => {
    const { ctx, writes } = createCtx();
    const result = await handleUpdatePreferences(ctx, {});
    expect(writes).toHaveLength(0);
    expect(result.content[0]?.text).toContain('No preferences were updated');
  });
});
