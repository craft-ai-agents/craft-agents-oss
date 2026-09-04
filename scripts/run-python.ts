#!/usr/bin/env bun

const forwardedArgs = process.argv.slice(2)

interface PythonCandidate {
  command: string
  prefixArgs?: string[]
}

const configuredPython = process.env.CRAFT_PYTHON?.trim()
const candidates: PythonCandidate[] = [
  ...(configuredPython ? [{ command: configuredPython }] : []),
  ...(process.platform === 'win32'
    ? [{ command: 'python' }, { command: 'py', prefixArgs: ['-3'] }, { command: 'python3' }]
    : [{ command: 'python3' }, { command: 'python' }]),
]

let selected: PythonCandidate | undefined
for (const candidate of candidates) {
  const probe = Bun.spawnSync([candidate.command, ...(candidate.prefixArgs ?? []), '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (probe.exitCode === 0) {
    selected = candidate
    break
  }
}

if (!selected) {
  console.error('No working Python 3 interpreter was found. Set CRAFT_PYTHON to its executable path.')
  process.exit(1)
}

const child = Bun.spawnSync([
  selected.command,
  ...(selected.prefixArgs ?? []),
  ...forwardedArgs,
], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(child.exitCode)
