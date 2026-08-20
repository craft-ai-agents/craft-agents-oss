/** Focused local Craft Markdown Notes import contract tests. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, relative, sep } from 'path'
import {
  CRAFT_MARKDOWN_IMPORT_FORMAT,
  importCraftMarkdownNotes,
  importNotes,
  NOTES_MIGRATION_MAP_VERSION,
  notesMigrationMapPath,
  readNotesMigrationMap,
  writeNotesMigrationMap,
} from '../notes-migration'

function toSlashPath(path: string): string {
  return path.split(sep).join('/')
}

async function writeSourceFile(sourceRoot: string, relativePath: string, content: string | Buffer): Promise<void> {
  const path = join(sourceRoot, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

describe('local Craft Markdown Notes import', () => {
  let workspaceRoot: string
  let sourceRoot: string
  let destinationRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'notes-import-ws-'))
    sourceRoot = join(workspaceRoot, 'selected-craft-vault')
    destinationRoot = join(workspaceRoot, 'local-notes')
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(destinationRoot, { recursive: true }),
    ])
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('imports into local Notes while preserving frontmatter, internal links, assets, and the source vault', async () => {
    const alpha = [
      '---',
      'title: "Alpha"',
      'tags:',
      '  - preserved',
      'custom: keep-this-exactly',
      '---',
      '',
      'See [[projects/beta|Beta]] and ![image](assets/picture.png).',
      '',
    ].join('\n')
    const beta = '# Beta\n\nLinked content.\n'
    await writeSourceFile(sourceRoot, 'alpha.md', alpha)
    await writeSourceFile(sourceRoot, 'projects/beta.md', beta)
    await writeSourceFile(sourceRoot, 'assets/picture.png', Buffer.from([0, 1, 2, 3]))

    const first = await importNotes({
      workspaceRoot,
      sourceRoot,
      destinationRoot,
      format: CRAFT_MARKDOWN_IMPORT_FORMAT,
      now: () => 1_700_000_000_000,
    })

    expect(first.migrated).toBe(2)
    expect(first.skipped).toBe(0)
    expect(first.failed).toEqual([])
    expect(first.destinationRoot).toBe(await realpath(destinationRoot))
    expect(first.mapPath).toBe(notesMigrationMapPath(await realpath(workspaceRoot)))

    const map = await readNotesMigrationMap(workspaceRoot)
    expect(map.version).toBe(NOTES_MIGRATION_MAP_VERSION)
    const alphaEntry = map.entries.find((entry) => entry.sourcePath === 'alpha.md')!
    const betaEntry = map.entries.find((entry) => entry.sourcePath === 'projects/beta.md')!
    const assetEntry = map.assets.find((entry) => entry.sourcePath === 'assets/picture.png')!
    expect(alphaEntry.state).toBe('completed')
    expect(betaEntry.state).toBe('completed')
    expect(assetEntry.state).toBe('completed')

    const importedAlpha = await readFile(join(destinationRoot, alphaEntry.destinationPath), 'utf-8')
    expect(importedAlpha).toContain('---\ntitle: "Alpha"\ntags:\n  - preserved\ncustom: keep-this-exactly\n---')
    expect(importedAlpha).toContain(`[[${betaEntry.destinationNoteId}|Beta]]`)
    const relativeAssetPath = toSlashPath(relative(dirname(alphaEntry.destinationPath), assetEntry.destinationPath))
    expect(importedAlpha).toContain(`![image](${relativeAssetPath})`)
    expect(await readFile(join(destinationRoot, assetEntry.destinationPath))).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(await readFile(join(sourceRoot, 'alpha.md'), 'utf-8')).toBe(alpha)
    expect(await readFile(join(sourceRoot, 'projects/beta.md'), 'utf-8')).toBe(beta)

    const second = await importNotes({
      workspaceRoot,
      sourceRoot,
      destinationRoot,
      format: CRAFT_MARKDOWN_IMPORT_FORMAT,
    })
    expect(second.migrated).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.failed).toEqual([])
  })

  it('resumes a pending checkpoint after an injected interruption without duplicate Notes', async () => {
    await writeSourceFile(sourceRoot, 'alpha.md', '# Alpha\n')
    await writeSourceFile(sourceRoot, 'beta.md', '# Beta\n')

    await expect(importCraftMarkdownNotes({
      workspaceRoot,
      sourceRoot,
      destinationRoot,
      onCheckpoint: ({ stage, sourcePath }) => {
        if (stage === 'note-planned' && sourcePath === 'alpha.md') {
          throw new Error('injected interruption')
        }
      },
    })).rejects.toThrow('injected interruption')

    const interruptedMap = await readNotesMigrationMap(workspaceRoot)
    const alphaCheckpoint = interruptedMap.entries.find((entry) => entry.sourcePath === 'alpha.md')!
    expect(alphaCheckpoint.state).toBe('pending')
    expect(existsSync(join(destinationRoot, alphaCheckpoint.destinationPath))).toBe(false)

    const resumed = await importCraftMarkdownNotes({ workspaceRoot, sourceRoot, destinationRoot })
    expect(resumed.migrated).toBe(2)
    expect(resumed.failed).toEqual([])

    const finalMap = await readNotesMigrationMap(workspaceRoot)
    const alphaEntry = finalMap.entries.find((entry) => entry.sourcePath === 'alpha.md')!
    expect(alphaEntry.destinationPath).toBe(alphaCheckpoint.destinationPath)
    expect((await readdir(join(destinationRoot, dirname(alphaEntry.destinationPath)))).filter((name) => name.toLowerCase().endsWith('.md'))).toHaveLength(2)
  })

  it('writes complete maps atomically and preserves a legacy map payload', async () => {
    const legacyPath = notesMigrationMapPath(workspaceRoot)
    await mkdir(dirname(legacyPath), { recursive: true })
    await writeFile(legacyPath, JSON.stringify({
      version: 1,
      notebookId: 'legacy-notebook',
      entries: [{
        noteId: 'old',
        path: '/Craft Notes/old',
        siyuanId: 'legacy-doc',
        title: 'Old',
        migratedAt: 1,
      }],
    }))

    const map = await readNotesMigrationMap(workspaceRoot)
    expect(map.entries).toEqual([])
    expect(map.legacySiyuan?.entries).toHaveLength(1)
    await writeNotesMigrationMap(workspaceRoot, map)

    const raw = await readFile(legacyPath, 'utf-8')
    expect(JSON.parse(raw)).toMatchObject({
      version: NOTES_MIGRATION_MAP_VERSION,
      legacySiyuan: { notebookId: 'legacy-notebook' },
    })
    expect((await readdir(dirname(legacyPath))).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('rejects unsafe symlink paths and unsupported formats before writing Notes', async () => {
    const outsideRoot = join(workspaceRoot, 'outside')
    await mkdir(outsideRoot, { recursive: true })
    await writeSourceFile(outsideRoot, 'secret.md', '# Not importable\n')
    await symlink(join(outsideRoot, 'secret.md'), join(sourceRoot, 'escape.md'))

    await expect(importCraftMarkdownNotes({ workspaceRoot, sourceRoot, destinationRoot })).rejects.toThrow('Unsafe notes import path')
    expect(await readdir(destinationRoot)).toEqual([])

    await expect(importNotes({
      workspaceRoot,
      sourceRoot,
      destinationRoot,
      format: 'unsupported-format',
    })).rejects.toThrow('Unsupported notes import format')
  })

  it('enforces the asset byte cap before creating an import map', async () => {
    await writeSourceFile(sourceRoot, 'note.md', '# Note\n')
    await writeSourceFile(sourceRoot, 'assets/too-large.bin', Buffer.from([1, 2]))

    await expect(importCraftMarkdownNotes({
      workspaceRoot,
      sourceRoot,
      destinationRoot,
      limits: { maxAssetBytes: 1 },
    })).rejects.toThrow('asset exceeds')
    expect(existsSync(notesMigrationMapPath(workspaceRoot))).toBe(false)
  })
})
