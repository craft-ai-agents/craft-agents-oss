import { mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSourceCredentialManager, type LoadedSource } from '@craft-agent/shared/sources'

const YOUTUBE_RESEARCH_SOURCE_SLUG = 'youtube-research'

export function getYouTubeResearchCredentialCachePath(): string {
  return join(homedir(), '.config', 'runneros', 'youtube-research', 'credentials.json')
}

export async function syncYouTubeResearchCredentialCache(source: LoadedSource): Promise<void> {
  if (source.config.slug !== YOUTUBE_RESEARCH_SOURCE_SLUG) return

  const cachePath = getYouTubeResearchCredentialCachePath()
  const cred = await getSourceCredentialManager().loadEffective(source)
  if (!cred?.value) {
    await rm(cachePath, { force: true })
    return
  }

  await mkdir(join(homedir(), '.config', 'runneros', 'youtube-research'), { recursive: true })
  // The bundled upstream CLI reads YOUTUBE_API_KEY from its process env.
  // This cache is the bridge from RunnerOS credentials into that local wrapper;
  // it must be cleared any time the effective source credential disappears.
  await writeFile(cachePath, JSON.stringify({
    apiKey: cred.value,
    updatedAt: Date.now(),
  }, null, 2), 'utf8')
  await chmod(cachePath, 0o600).catch(() => undefined)
}
