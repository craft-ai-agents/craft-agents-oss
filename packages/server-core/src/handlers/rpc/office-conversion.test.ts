import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { convertOfficeFileToMarkdown } from './office-conversion'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'office-conversion-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source, 'utf-8')
  chmodSync(path, 0o755)
}

describe('convertOfficeFileToMarkdown', () => {
  test('invokes bundled markitdown cli through uv and writes output', async () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir)
    writeFileSync(join(scriptsDir, 'markitdown_cli.py'), '# fake converter script\n', 'utf-8')

    const fakeUv = join(dir, 'fake-uv.js')
    writeExecutable(
      fakeUv,
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const input = args[args.length - 3];
const output = args[args.length - 1];
fs.writeFileSync(output, 'converted:' + path.basename(input), 'utf8');
`,
    )

    const inputPath = join(dir, 'sample.docx')
    const outputPath = join(dir, 'sample.md')
    writeFileSync(inputPath, 'fake docx', 'utf-8')

    await convertOfficeFileToMarkdown(inputPath, outputPath, {
      env: {
        CRAFT_UV: fakeUv,
        CRAFT_SCRIPTS: scriptsDir,
      },
    })

    expect(readFileSync(outputPath, 'utf-8')).toBe(`converted:${basename(inputPath)}`)
  })

  test('fails loudly when converter script is unavailable', async () => {
    const inputPath = join(dir, 'sample.docx')
    const outputPath = join(dir, 'sample.md')
    writeFileSync(inputPath, 'fake docx', 'utf-8')

    await expect(convertOfficeFileToMarkdown(inputPath, outputPath, {
      env: {
        CRAFT_UV: join(dir, 'missing-uv'),
        CRAFT_SCRIPTS: join(dir, 'missing-scripts'),
      },
    })).rejects.toThrow('Document converter script not found')
  })
})

