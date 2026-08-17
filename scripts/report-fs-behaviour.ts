/**
 * Report what the filesystem under this runner actually does.
 *
 * Craft Pages' naming rules exist because the three platforms disagree about
 * when two distinct names are the same file. Those rules are pure string logic
 * (packages/session-tools-core/src/pages/naming.ts) so they can be tested from
 * any machine — which is exactly why the ASSUMPTIONS behind them need checking
 * on the machine itself.
 *
 * Diagnostic, not a gate: it never fails the build. Its job is to make a CI log
 * answer "why did that test behave differently here?" without a re-run, and to
 * state plainly when a platform cannot exercise a security property at all.
 */

import { mkdtempSync, writeFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'craft-fs-probe-'))
const lines: string[] = []
const say = (k: string, v: string) => lines.push(`  ${k.padEnd(26)} ${v}`)

try {
  say('platform', `${platform()} (${process.arch})`)

  // Case folding — decides whether "A.html" and "a.html" collide.
  writeFileSync(join(dir, 'case.txt'), 'x')
  let caseInsensitive = false
  try {
    readdirSync(dir)
    const { statSync } = await import('node:fs')
    statSync(join(dir, 'CASE.TXT'))
    caseInsensitive = true
  } catch { caseInsensitive = false }
  say('case folding', caseInsensitive ? 'INSENSITIVE (A.txt === a.txt)' : 'sensitive')

  // Unicode normalisation — the collision nobody can see, because the two
  // names render identically. Measured: one file on APFS, two on ext4.
  const nfc = 'café.txt'
  const nfd = 'café.txt'
  writeFileSync(join(dir, nfc), 'NFC')
  writeFileSync(join(dir, nfd), 'NFD')
  const normCount = readdirSync(dir).filter(n => n.toLowerCase().startsWith('caf')).length
  say('unicode normalisation', normCount === 1 ? 'FOLDED (NFC === NFD)' : 'preserved (distinct files)')

  // Trailing dots and spaces — Windows silently strips these, so "a .txt" and
  // "a.txt" become one file there and stay distinct everywhere else.
  let trailingStripped = false
  try {
    writeFileSync(join(dir, 'trail .txt'), 'x')
    trailingStripped = !readdirSync(dir).includes('trail .txt')
  } catch { trailingStripped = true }
  say('trailing space in name', trailingStripped ? 'STRIPPED or refused' : 'preserved')

  // Symlink creation — three containment tests depend on it (ADR 0001 D9).
  // Windows needs privilege; if it is unavailable here, those tests cannot
  // verify the guard on this platform and the log must say so.
  let symlinks = 'yes'
  try {
    writeFileSync(join(dir, 'target.txt'), 'x')
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'))
  } catch (err) {
    symlinks = `NO — ${(err as Error).message.split('\n')[0]}`
  }
  say('symlink creation', symlinks)

  say('tmpdir', tmpdir())

  console.log('\nFilesystem behaviour on this runner:')
  console.log(lines.join('\n'))

  if (symlinks !== 'yes') {
    console.log(
      '\n::warning::Symlinks cannot be created here, so the containment guard\'s'
      + ' symlink-escape tests (ADR 0001 D9) do not verify anything on this platform.',
    )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
