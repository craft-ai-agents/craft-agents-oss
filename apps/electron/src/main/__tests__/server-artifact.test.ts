import { describe, it, expect } from 'bun:test'
import {
  parseUnameTarget,
  resolveServerArtifact,
} from '../ssh-tunnel/server-artifact.ts'

describe('parseUnameTarget', () => {
  it('maps linux x86_64', () => {
    expect(parseUnameTarget('Linux x86_64')).toEqual({ platform: 'linux', arch: 'x64' })
  })
  it('maps darwin arm64', () => {
    expect(parseUnameTarget('Darwin arm64')).toEqual({ platform: 'darwin', arch: 'arm64' })
  })
  it('maps aarch64 to arm64 and amd64 to x64', () => {
    expect(parseUnameTarget('Linux aarch64').arch).toBe('arm64')
    expect(parseUnameTarget('Linux amd64').arch).toBe('x64')
  })
  it('rejects unsupported OS', () => {
    expect(() => parseUnameTarget('FreeBSD amd64')).toThrow(/Unsupported remote OS/)
  })
  it('rejects unsupported arch', () => {
    expect(() => parseUnameTarget('Linux i686')).toThrow(/Unsupported remote architecture/)
  })
})

describe('resolveServerArtifact', () => {
  it('rejects in packaged mode with a clear, escape-hatch-pointing error', async () => {
    await expect(
      resolveServerArtifact(
        { platform: 'linux', arch: 'x64' },
        { isPackaged: true, fileExists: () => false, runBuild: async () => {} },
      ),
    ).rejects.toThrow(/Connect to remote server|packaged/i)
  })

  it('reuses a cached artifact without building', async () => {
    let built = 0
    const result = await resolveServerArtifact(
      { platform: 'darwin', arch: 'arm64' },
      {
        isPackaged: false,
        fileExists: () => true, // artifact already present
        runBuild: async () => {
          built++
        },
      },
    )
    expect(built).toBe(0)
    expect(result.archiveName).toMatch(/^craft-server-.*-darwin-arm64\.tar\.gz$/)
  })

  it('builds on demand when the artifact is missing, then finds it', async () => {
    let built = 0
    let exists = false
    const result = await resolveServerArtifact(
      { platform: 'linux', arch: 'arm64' },
      {
        isPackaged: false,
        fileExists: () => exists,
        runBuild: async () => {
          built++
          exists = true // build produced the artifact
        },
      },
    )
    expect(built).toBe(1)
    expect(result.archiveName).toContain('linux-arm64')
  })

  it('errors if the build claims success but produces no artifact', async () => {
    await expect(
      resolveServerArtifact(
        { platform: 'linux', arch: 'x64' },
        { isPackaged: false, fileExists: () => false, runBuild: async () => {} },
      ),
    ).rejects.toThrow(/artifact was not found/)
  })
})
