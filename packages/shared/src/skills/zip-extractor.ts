import { unzipSync, strFromU8 } from 'fflate'
import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import matter from 'gray-matter'
import type { DiscoveredSkill, SkillMetadata } from './types.ts'
import { deriveSkillSlug } from './storage.ts'

function parseSkillMd(raw: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(raw)
    if (!parsed.data.name || !parsed.data.description) return null
    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon: parsed.data.icon as string | undefined,
      },
      body: parsed.content,
    }
  } catch {
    return null
  }
}

/**
 * Extract DiscoveredSkill entries from a .zip archive.
 *
 * Discovery rules:
 * - SKILL.md at the zip root → one skill; slug derived from the zip filename.
 * - SKILL.md in a subdirectory at depth 1 or 2 → one skill per directory.
 * - SKILL.md deeper than 2 levels is ignored.
 * - __MACOSX entries are skipped.
 */
export function extractSkillsFromZip(zipPath: string): DiscoveredSkill[] {
  const buf = readFileSync(zipPath)
  const unzipped = unzipSync(new Uint8Array(buf))

  // Normalise paths and drop macOS metadata entries
  const files = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(unzipped)) {
    const normalised = path.replace(/\\/g, '/')
    if (normalised.startsWith('__MACOSX/') || normalised.includes('/__MACOSX/')) continue
    files.set(normalised, data)
  }

  // Check for a root-level SKILL.md first
  const rootData = files.get('SKILL.md')
  if (rootData) {
    const parsed = parseSkillMd(strFromU8(rootData))
    if (parsed) {
      return [{
        slug: deriveSkillSlug(basename(zipPath, extname(zipPath))),
        metadata: parsed.metadata,
        content: parsed.body,
        sourcePath: zipPath,
      }]
    }
  }

  // Scan subdirectories up to 2 levels deep
  const byDir = new Map<string, DiscoveredSkill>()
  for (const [filePath, data] of files) {
    const parts = filePath.split('/')
    if (parts[parts.length - 1] !== 'SKILL.md') continue

    // depth = number of directory levels above SKILL.md
    const depth = parts.length - 1
    if (depth === 0 || depth > 2) continue

    const parsed = parseSkillMd(strFromU8(data))
    if (!parsed) continue

    const dirPath = parts.slice(0, depth).join('/')
    const dirName = parts[depth - 1] ?? dirPath
    byDir.set(dirPath, {
      slug: deriveSkillSlug(dirName),
      metadata: parsed.metadata,
      content: parsed.body,
      sourcePath: `${zipPath}/${dirPath}`,
    })
  }

  return Array.from(byDir.values())
}
