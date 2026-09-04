const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

module.exports = async function beforePack(context) {
  const root = resolve(__dirname, '../../..')
  const release = JSON.parse(readFileSync(resolve(root, 'packages/shared/src/desktop-release.json'), 'utf8'))
  const production = process.env.JONWORK_RELEASE === 'production' || release.channel === 'production'
  execFileSync('bun', [resolve(root, 'scripts/validate-desktop-release.ts'),
    `--platform=${context.electronPlatformName}`, ...(production ? ['--production'] : [])], { cwd: root, stdio: 'inherit', windowsHide: true })
  const config = context.packager.config
  if (config.nsis?.deleteAppDataOnUninstall !== false) throw new Error('Packaging must preserve customer application data on uninstall')
  // Both runtime and updater metadata use the same public, versioned config.
  config.publish = release.updatesEnabled ? [{ provider: 'generic', url: release.updateServerUrl }] : null
  // Internal Windows builds run on developer workstations that may not have
  // symlink privileges. Skipping rcedit avoids downloading the winCodeSign
  // bundle (which contains macOS symlinks); production still requires the
  // normal signed executable path below.
  if (!production && context.electronPlatformName === 'win32') {
    config.win = { ...config.win, signAndEditExecutable: false }
  }
  if (production) {
    execFileSync('bun', [resolve(root, 'scripts/desktop-build-stamp.ts'), 'verify'], { cwd: root, stdio: 'inherit', windowsHide: true })
    config.forceCodeSigning = context.electronPlatformName !== 'linux'
    config.mac = { ...config.mac, notarize: true }
    config.win = { ...config.win, signAndEditExecutable: true, verifyUpdateCodeSignature: true }
  }
}
