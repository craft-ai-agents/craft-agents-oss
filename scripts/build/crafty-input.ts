/**
 * Crafty (spike): compiles the native input addon (`apps/electron/src/crafty-native/crafty-input.c`,
 * the double-tap trigger's event tap, plus `crafty-pasteboard.m`, the ⌘C fallback) to
 * `apps/electron/dist/native/crafty-input.node`, which electron-builder ships with the rest of
 * `dist/`. macOS only; needs the Xcode Command Line Tools.
 *
 * - Plain clang, no node-gyp: a C and an Objective-C file against the N-API headers
 *   (`node-api-headers`). N-API is ABI-stable, so Electron upgrades need no rebuild and no
 *   Electron headers.
 * - Universal (arm64 + x86_64, ~90 KB), so a hand-built Intel app (`dist:mac:x64`) works too.
 * - macOS 12 is Electron 39's minimum.
 *
 * Used by `scripts/electron-build-main.ts` (a failure fails the build) and `scripts/electron-dev.ts`
 * (a failure only turns the double-tap off).
 */

import { spawn } from 'bun'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

export const CRAFTY_INPUT_SOURCE = 'apps/electron/src/crafty-native/crafty-input.c'
export const CRAFTY_PASTEBOARD_SOURCE = 'apps/electron/src/crafty-native/crafty-pasteboard.m'
export const CRAFTY_INPUT_OUTPUT = 'apps/electron/dist/native/crafty-input.node'

export async function compileCraftyInput(rootDir: string): Promise<string> {
  const source = join(rootDir, CRAFTY_INPUT_SOURCE)
  const pasteboardSource = join(rootDir, CRAFTY_PASTEBOARD_SOURCE)
  const output = join(rootDir, CRAFTY_INPUT_OUTPUT)
  const headers = join(rootDir, 'node_modules/node-api-headers/include')
  if (!existsSync(join(headers, 'node_api.h'))) {
    throw new Error(`node-api-headers not found in the root node_modules (${headers}). Run 'bun install'.`)
  }
  mkdirSync(dirname(output), { recursive: true })
  const proc = spawn({
    cmd: [
      'xcrun', 'clang',
      '-O2', '-Wall', '-Wextra',
      '-arch', 'arm64', '-arch', 'x86_64',
      '-mmacosx-version-min=12.0',
      '-I', headers,
      // A loadable bundle whose napi_* symbols come from the Electron process that loads it
      '-bundle', '-undefined', 'dynamic_lookup',
      '-framework', 'ApplicationServices',
      '-framework', 'AppKit',
      '-o', output,
      '-x', 'c', '-std=c11', source,
      '-x', 'objective-c', '-fobjc-arc', pasteboardSource,
    ],
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`clang exited with ${exitCode} (are the Xcode Command Line Tools installed? xcode-select --install)`)
  if (!existsSync(output)) throw new Error(`clang produced no ${output}`)
  return output
}
