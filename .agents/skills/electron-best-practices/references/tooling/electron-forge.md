# Electron Forge: Packaging, Distribution, and Maker Configuration

## Overview

Electron Forge is the official, first-party packaging and distribution tool for
Electron applications. Maintained by the Electron team, it handles the full
lifecycle from source to distribution: packaging with `@electron/packager`,
creating platform-specific installers with makers, and uploading releases with
publishers.

---

## Why Forge Over electron-builder

Both tools are widely used, but they serve different philosophies:

**Electron Forge advantages:**
- First-party support from the Electron team
- ASAR integrity verification (prevents tampering with app bundles)
- Native support for Electron Fuses (security toggles baked into the binary)
- Universal macOS builds (arm64 + x64 in a single binary)
- Tighter integration with Electron's security model
- Plugin architecture for extensibility

**electron-builder advantages:**
- Higher community adoption (more Stack Overflow answers, tutorials)
- More configuration options out of the box
- Built-in auto-update server support
- Snap and Flatpak makers without additional setup
- Single YAML or JSON configuration file

For new projects, Electron Forge is recommended due to its first-party status and
security features. For existing electron-builder projects, migration is possible
but not always necessary.

---

## Installation and Initialization

### New Project

When using the electron-vite template, Forge is included by default. For manual
setup:

```bash
# Initialize Forge in an existing Electron project
npx electron-forge import

# Or start a new project with Forge's own template
npx create-electron-app my-app --template=vite-typescript
```

### Adding to an Existing Project

```bash
npm install --save-dev @electron-forge/cli @electron-forge/maker-squirrel \
  @electron-forge/maker-zip @electron-forge/maker-deb @electron-forge/maker-rpm \
  @electron-forge/maker-dmg @electron-forge/plugin-fuses @electron/fuses
```

---

## Configuration File Structure

Forge can be configured in `forge.config.js` (recommended), `forge.config.ts`,
or in the `config.forge` field of `package.json`. The JavaScript file format is
preferred because it allows environment variable access and conditional logic.

```javascript
// forge.config.js - Complete production configuration
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './resources/icon',
    osxSign: {},
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        certificateFile: process.env.WINDOWS_CERT_FILE,
        certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Your Name',
          homepage: 'https://example.com',
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'your-org', name: 'your-app' },
        prerelease: true,
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
    }),
  ],
};
```

---

## Makers: Platform-Specific Installers

Makers transform the packaged application into distributable formats for each OS.

### Windows: Squirrel

Squirrel.Windows creates an auto-updating installer with delta updates. It installs
per-user (no admin required) and manages the update lifecycle automatically.

```javascript
{
  name: '@electron-forge/maker-squirrel',
  config: {
    name: 'my-app',
    authors: 'Your Company',
    description: 'A desktop application',
    setupIcon: './resources/icon.ico',
    // Code signing
    certificateFile: process.env.WINDOWS_CERT_FILE,
    certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
    // Delta updates reduce download size for existing users
    remoteReleases: 'https://releases.example.com/updates/win32',
  },
}
```

### macOS: DMG and ZIP

DMG provides the familiar drag-to-Applications experience. ZIP is required for
Sparkle-based auto-updates and is the format `electron-updater` expects.

```javascript
// DMG for direct downloads
{
  name: '@electron-forge/maker-dmg',
  config: {
    format: 'ULFO',                // lzfse compression (best ratio)
    background: './resources/dmg-background.png',
    icon: './resources/icon.icns',
    contents: [
      { x: 130, y: 220, type: 'file', path: '' },  // App position
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
}

// ZIP for auto-updates
{
  name: '@electron-forge/maker-zip',
  platforms: ['darwin'],
}
```

### Linux: deb and rpm

```javascript
// Debian-based (Ubuntu, Debian, Mint)
{
  name: '@electron-forge/maker-deb',
  config: {
    options: {
      maintainer: 'Your Name <you@example.com>',
      homepage: 'https://example.com',
      icon: './resources/icon.png',
      categories: ['Utility'],
      depends: ['libnotify4', 'libsecret-1-0'],
    },
  },
}

// RPM-based (Fedora, RHEL, SUSE)
{
  name: '@electron-forge/maker-rpm',
  config: {
    options: {
      homepage: 'https://example.com',
      icon: './resources/icon.png',
      categories: ['Utility'],
    },
  },
}
```

---

## Publishers

Publishers upload built artifacts to distribution platforms.

### GitHub Releases

```javascript
{
  name: '@electron-forge/publisher-github',
  config: {
    repository: {
      owner: 'your-org',
      name: 'your-app',
    },
    prerelease: false,
    draft: true,        // Create as draft, manually publish after verification
    tagPrefix: 'v',     // Tags releases as v1.0.0
  },
}
```

S3 publishing is also available via `@electron-forge/publisher-s3` with bucket,
region, and key resolver configuration.

---

## Electron Fuses and ASAR Integrity

Fuses are compile-time security toggles flipped in the Electron binary itself.
Once set, they cannot be changed at runtime. ASAR (Atom Shell Archive) packs your
application into a single archive; when combined with the `OnlyLoadAppFromAsar`
fuse, Electron refuses to load from loose files, preventing code tampering.

```javascript
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Fuses plugin with ASAR integrity
new FusesPlugin({
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
})

// ASAR config in packagerConfig (native modules must be unpacked)
// packagerConfig: { asar: { unpack: '*.{node,dll}' } }
```

---

## Hooks and Universal macOS Builds

Forge provides lifecycle hooks (`generateAssets`, `postPackage`, `postMake`) for
custom logic at each stage of the packaging pipeline.

```javascript
module.exports = {
  hooks: {
    generateAssets: async () => { /* pre-packaging: build, generate icons */ },
    postPackage: async (config, result) => {
      console.log(`Packaged for ${result.platform}/${result.arch}`);
    },
    postMake: async (config, results) => {
      // Custom post-processing, additional signing, etc.
      return results;
    },
  },
};
```

Universal binaries contain both arm64 (Apple Silicon) and x64 (Intel) code in a
single binary, providing native performance on all Mac hardware.

```javascript
module.exports = {
  packagerConfig: {
    osxUniversal: { x64ArchFiles: '*.node' },
    osxSign: { /* signing config */ },
    osxNotarize: { /* notarize config */ },
  },
};
```

```bash
npx electron-forge make --arch=universal --platform=darwin
```

---

## Integration with electron-vite

When using electron-vite for development and building, Forge handles only the
packaging and distribution stages. The typical workflow is:

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-vite build && electron-forge package",
    "make": "electron-vite build && electron-forge make",
    "publish": "electron-vite build && electron-forge publish"
  }
}
```

The `electron-vite build` step compiles your source into the `out/` directory,
and then Forge packages the contents of `out/` along with `node_modules` and
`package.json` into the final distributable.

---

## See Also

- [electron-vite Configuration](./electron-vite.md) -- Build tool configuration
  that feeds into Forge's packaging pipeline
- [Code Signing](../packaging/code-signing.md) -- Detailed signing and
  notarization setup for all platforms
- [CI/CD Patterns](../packaging/ci-cd-patterns.md) -- Automating Forge builds
  in continuous integration pipelines
- [Tauri Comparison](./tauri-comparison.md) -- Alternative framework comparison
  including packaging and distribution differences
