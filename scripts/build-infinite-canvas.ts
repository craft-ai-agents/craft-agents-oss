import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const canvas = resolve(root, 'apps/electron/vendor/infinite-canvas/web')
if (!existsSync(resolve(canvas, 'node_modules/vite'))) throw new Error('Install the vendored canvas dependencies before building (see vendor/infinite-canvas/JONWORK-INTEGRATION.md).')
const child = Bun.spawn([process.execPath, 'run', 'build'], { cwd: canvas, env: { ...process.env, VITE_BASE: './' }, stdout: 'inherit', stderr: 'inherit' })
if (await child.exited !== 0) throw new Error('Canvas build failed; public bundle was not updated')
const destination = resolve(root, 'apps/electron/src/renderer/public/infinite-canvas')
rmSync(destination, { recursive: true, force: true })
cpSync(resolve(canvas, 'dist'), destination, { recursive: true })
console.log('Canvas bundle rebuilt and copied to the desktop renderer public assets.')
