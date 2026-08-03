#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripPythonInterpreterEnvironment } from './python-env'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TEST_MODULES = [
  'apps.electron.resources.scripts.tests.test_tool_test_harness',
  'apps.electron.resources.scripts.tests.test_pdf_tool_smoke',
  'apps.electron.resources.scripts.tests.test_xlsx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_docx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_pptx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_img_tool_smoke',
  'apps.electron.resources.scripts.tests.test_ical_tool_smoke',
  'apps.electron.resources.scripts.tests.test_doc_diff_smoke',
  'apps.electron.resources.scripts.tests.test_markitdown_smoke',
] as const


const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv'
const bundledUv = resolve(
  ROOT,
  'apps',
  'electron',
  'resources',
  'bin',
  `${process.platform}-${process.arch}`,
  uvName,
)
const uv = process.env.ARCHSTUDIO_UV?.trim() || (existsSync(bundledUv) ? bundledUv : 'uv')
const env = stripPythonInterpreterEnvironment(process.env)

const probe = spawnSync(uv, ['--version'], {
  cwd: ROOT,
  env,
  stdio: 'ignore',
  shell: false,
})

if (probe.status !== 0) {
  console.error(`No usable uv executable found (checked ${bundledUv} and PATH).`)
  process.exit(1)
}

const result = spawnSync(
  uv,
  ['run', '--python', '3.12', '-m', 'unittest', ...TEST_MODULES],
  {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: false,
  },
)

if (result.error) {
  console.error(`Failed to start document-tool tests: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
