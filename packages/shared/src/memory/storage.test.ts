import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteMemoryEntry,
  getAgentMemoryFile,
  getUserMemoryFile,
  isMemoryNameDeleted,
  listAgentMemoryEntries,
  listUserMemoryEntries,
  loadAgentMemory,
  loadUserMemory,
  parseMemoryFile,
  readDeletedMemoryNames,
  saveMemoryEntry,
  serializeMemoryFile,
  updateMemoryEntry,
} from './storage.ts';
import type { MemoryEntry, MemoryStorageOptions } from './types.ts';

let root: string;
let options: MemoryStorageOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-memory-test-'));
  options = { globalAgentsDir: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('parseMemoryFile', () => {
  test('parses USER.md with repeated entry mini-frontmatter', () => {
    const parsed = parseMemoryFile(`---
version: 1
---

---
name: identity
type: user
created: 2026-04-15
---

Mikey, principal engineer pivoting to product.

---
name: collaboration style
type: feedback
created: 2026-04-16
expires: 2026-12-31
---

Direct and terse.
`, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.entries.map((entry) => entry.name)).toEqual(['identity', 'collaboration style']);
    expect(parsed!.entries[1]!.expires).toBe('2026-12-31');
    expect(parsed!.warnings).toEqual([]);
  });

  test('rejects agent MEMORY.md when envelope agent mismatches the directory slug', () => {
    const parsed = parseMemoryFile(`---
agent: writer
version: 1
---
`, 'agent', 'researcher');

    expect(parsed).toBeNull();
  });

  test('skips invalid entries and returns parse warnings', () => {
    const parsed = parseMemoryFile(`---
version: 1
---

---
name: good
type: user
created: 2026-04-15
---

Body.

---
name: bad
type: nope
created: 2026-04-15
---

Bad type.

---
name: good
type: feedback
created: 2026-04-16
---

Duplicate.
`, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.entries.map((entry) => entry.name)).toEqual(['good']);
    expect(parsed!.warnings.map((w) => w.code)).toEqual(['invalid-type', 'duplicate-name']);
  });

  test('allows horizontal rules in entry bodies without splitting entries', () => {
    const parsed = parseMemoryFile(`---
version: 1
---

---
name: with hr
type: reference
created: 2026-04-15
---

The body has a thematic break.

---

That line is content, not a new memory entry.

---
name: after hr
type: feedback
created: 2026-04-16
---

Second body.
`, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.warnings).toEqual([]);
    expect(parsed!.entries.map((entry) => entry.name)).toEqual(['with hr', 'after hr']);
    expect(parsed!.entries[0]!.body).toContain('That line is content');
  });

  test('does not split on body text that only resembles partial frontmatter', () => {
    const parsed = parseMemoryFile(`---
version: 1
---

---
name: with partial yaml
type: reference
created: 2026-04-15
---

The body has a thematic break followed by notes.

---
name: not-an-entry
because: missing required entry fields
---

Still the first body.

---
name: real entry
type: feedback
created: 2026-04-16
---

Second body.
`, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.warnings).toEqual([]);
    expect(parsed!.entries.map((entry) => entry.name)).toEqual(['with partial yaml', 'real entry']);
    expect(parsed!.entries[0]!.body).toContain('not-an-entry');
    expect(parsed!.entries[0]!.body).toContain('Still the first body');
  });

  test('allows frontmatter delimiters inside fenced code in entry bodies', () => {
    const parsed = parseMemoryFile(`---
version: 1
---

---
name: code sample
type: reference
created: 2026-04-15
---

\`\`\`md
---
name: not-an-entry
type: user
created: 2026-01-01
---
\`\`\`

Still the first body.

---
name: real entry
type: user
created: 2026-04-16
---

Second body.
`, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.warnings).toEqual([]);
    expect(parsed!.entries.map((entry) => entry.name)).toEqual(['code sample', 'real entry']);
    expect(parsed!.entries[0]!.body).toContain('not-an-entry');
  });
});

describe('serializeMemoryFile', () => {
  test('round-trips user memory entries', () => {
    const entries: MemoryEntry[] = [
      {
        name: 'identity',
        type: 'user',
        created: '2026-04-15',
        updated: '2026-04-16',
        body: 'Mikey, principal engineer.',
      },
    ];

    const text = serializeMemoryFile({ version: 1 }, entries);
    const parsed = parseMemoryFile(text, 'user');

    expect(parsed).not.toBeNull();
    expect(parsed!.entries).toEqual(entries);
  });
});

describe('storage paths and load', () => {
  test('uses USER.md at the configured agents root', () => {
    expect(getUserMemoryFile(options)).toBe(join(root, 'USER.md'));
    expect(loadUserMemory(options)!.entries).toEqual([]);
  });

  test('uses agents/<slug>/MEMORY.md for agent memory', () => {
    expect(getAgentMemoryFile('researcher', options)).toBe(join(root, 'agents', 'researcher', 'MEMORY.md'));
    expect(loadAgentMemory('researcher', options)!.entries).toEqual([]);
  });

  test('load skips malformed files', () => {
    writeFileSync(getUserMemoryFile(options), 'not frontmatter', 'utf-8');
    expect(loadUserMemory(options)).toBeNull();
  });

  test('list surfaces malformed files as errors instead of empty entries', () => {
    writeFileSync(getUserMemoryFile(options), 'not frontmatter', 'utf-8');
    expect(() => listUserMemoryEntries(options)).toThrow(/invalid or unreadable/);
  });
});

describe('CRUD', () => {
  test('save writes USER.md and suffixes colliding names', async () => {
    const first = await saveMemoryEntry({
      scope: 'user',
      name: 'identity',
      type: 'user',
      body: 'First.',
    }, options);
    const second = await saveMemoryEntry({
      scope: 'user',
      name: 'identity',
      type: 'user',
      body: 'Second.',
    }, options);

    expect(first.name).toBe('identity');
    expect(second.name).toBe('identity-v2');
    expect(listUserMemoryEntries(options).map((entry) => entry.name)).toEqual(['identity', 'identity-v2']);
    expect(existsSync(getUserMemoryFile(options))).toBe(true);
  });

  test('save writes per-agent MEMORY.md with matching envelope', async () => {
    await saveMemoryEntry({
      scope: 'agent',
      agentSlug: 'researcher',
      name: 'primary sources',
      type: 'feedback',
      body: 'Prefer primary sources.',
    }, options);

    const loaded = loadAgentMemory('researcher', options);
    expect(loaded!.envelope).toEqual({ version: 1, agent: 'researcher' });
    expect(loaded!.entries[0]!.name).toBe('primary sources');
  });

  test('update changes body/expires and stamps updated date without changing identity fields', async () => {
    await saveMemoryEntry({
      scope: 'user',
      name: 'identity',
      type: 'user',
      body: 'First.',
    }, options);

    const updated = await updateMemoryEntry({
      scope: 'user',
      name: 'identity',
      expires: '2026-12-31',
      body: 'Updated.',
    }, options);

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('identity');
    expect(updated!.type).toBe('user');
    expect(updated!.body).toBe('Updated.');
    expect(updated!.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(updated!.expires).toBe('2026-12-31');
    expect(isMemoryNameDeleted('user', 'identity', undefined, options)).toBe(false);
  });

  test('delete removes an entry and writes a tombstone', async () => {
    await saveMemoryEntry({
      scope: 'agent',
      agentSlug: 'critic',
      name: 'harsh feedback',
      type: 'feedback',
      body: 'Be direct.',
    }, options);

    expect(await deleteMemoryEntry({
      scope: 'agent',
      agentSlug: 'critic',
      name: 'harsh feedback',
    }, options)).toBe(true);

    expect(listAgentMemoryEntries('critic', options)).toEqual([]);
    expect(readDeletedMemoryNames('agent', 'critic', options).has('harsh feedback')).toBe(true);
    expect(readFileSync(join(root, 'agents', 'critic', '.deleted-memories.json'), 'utf-8')).toContain('harsh feedback');
  });

  test('concurrent saves for the same file serialize through the mutex', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      saveMemoryEntry({
        scope: 'user',
        name: 'same',
        type: 'user',
        body: `Body ${i}`,
      }, options),
    ));

    const names = listUserMemoryEntries(options).map((entry) => entry.name);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    expect(names[0]).toBe('same');
    // Suffix is `-vN` to match the agent slug convention.
    expect(names).toContain('same-v10');
    // The legacy parenthesized shape must not be produced any more.
    expect(names.some((n) => /^\bsame \(\d+\)$/.test(n))).toBe(false);
  });

  test('forget then save without force throws MemoryTombstonedError', async () => {
    await saveMemoryEntry({ scope: 'user', name: 'pet name', type: 'user', body: 'Charlie.' }, options);
    await deleteMemoryEntry({ scope: 'user', name: 'pet name' }, options);
    expect(isMemoryNameDeleted('user', 'pet name', undefined, options)).toBe(true);

    await expect(
      saveMemoryEntry({ scope: 'user', name: 'pet name', type: 'user', body: 'Charlie again.' }, options),
    ).rejects.toThrow(/previously forgotten/i);

    // Tombstone is preserved after a blocked save.
    expect(isMemoryNameDeleted('user', 'pet name', undefined, options)).toBe(true);
    expect(listUserMemoryEntries(options)).toEqual([]);
  });

  test('forget then save with force=true clears the tombstone and persists the entry', async () => {
    await saveMemoryEntry({ scope: 'user', name: 'pet name', type: 'user', body: 'Charlie.' }, options);
    await deleteMemoryEntry({ scope: 'user', name: 'pet name' }, options);

    const saved = await saveMemoryEntry(
      { scope: 'user', name: 'pet name', type: 'user', body: 'Buddy.', force: true },
      options,
    );
    expect(saved.name).toBe('pet name');
    expect(saved.body).toBe('Buddy.');
    expect(isMemoryNameDeleted('user', 'pet name', undefined, options)).toBe(false);
  });

  test('force only clears the matching tombstone name', async () => {
    await saveMemoryEntry({ scope: 'user', name: 'one', type: 'user', body: 'One.' }, options);
    await saveMemoryEntry({ scope: 'user', name: 'two', type: 'user', body: 'Two.' }, options);
    await deleteMemoryEntry({ scope: 'user', name: 'one' }, options);
    await deleteMemoryEntry({ scope: 'user', name: 'two' }, options);

    await saveMemoryEntry({ scope: 'user', name: 'one', type: 'user', body: 'One again.', force: true }, options);

    expect(isMemoryNameDeleted('user', 'one', undefined, options)).toBe(false);
    expect(isMemoryNameDeleted('user', 'two', undefined, options)).toBe(true);
  });

  test('save without force succeeds when no tombstone exists for the name', async () => {
    // A fresh save on a name that was NEVER deleted should NOT touch the
    // tombstone file at all (no spurious file creation).
    const tombstoneFile = join(root, '.deleted-memories.json');
    expect(existsSync(tombstoneFile)).toBe(false);

    await saveMemoryEntry({ scope: 'user', name: 'fresh', type: 'user', body: 'Body.' }, options);
    expect(existsSync(tombstoneFile)).toBe(false);
  });

  test('delete on missing file is a clean no-op (no file/tombstone created)', async () => {
    const memFile = getUserMemoryFile(options);
    const tombstoneFile = join(root, '.deleted-memories.json');
    expect(existsSync(memFile)).toBe(false);

    const removed = await deleteMemoryEntry({ scope: 'user', name: 'ghost' }, options);
    expect(removed).toBe(false);
    expect(existsSync(memFile)).toBe(false);
    expect(existsSync(tombstoneFile)).toBe(false);
  });

  test('delete on existing file but missing entry does not tombstone', async () => {
    await saveMemoryEntry({ scope: 'user', name: 'real', type: 'user', body: 'present.' }, options);
    const tombstoneFile = join(root, '.deleted-memories.json');

    const removed = await deleteMemoryEntry({ scope: 'user', name: 'ghost' }, options);
    expect(removed).toBe(false);
    expect(existsSync(tombstoneFile)).toBe(false);
    expect(isMemoryNameDeleted('user', 'ghost', undefined, options)).toBe(false);
  });
});
