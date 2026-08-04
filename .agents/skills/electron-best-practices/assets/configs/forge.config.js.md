# Electron Forge Configuration

Electron Forge handles the entire packaging and distribution pipeline for Electron applications. This configuration covers cross-platform installers (Windows Squirrel, macOS DMG/ZIP, Linux DEB/RPM), code signing for macOS and Windows, notarization for macOS Gatekeeper, GitHub Releases publishing, and Electron Fuses for hardening the security of the production binary. Adjust the TODO markers and environment variables to match your project.

```javascript
// forge.config.js
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './resources/icon',
    appBundleId: 'com.example.myapp',   // TODO: Set your bundle ID

    // macOS Code Signing
    osxSign: {
      identity: 'Developer ID Application: Your Name (TEAM_ID)',
      hardenedRuntime: true,
      entitlements: './entitlements.plist',
      'entitlements-inherit': './entitlements.plist',
    },
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    },

    // Universal macOS build (Intel + Apple Silicon)
    osxUniversal: {
      x64ArchFiles: '*',
    },
  },

  rebuildConfig: {},

  makers: [
    // Windows - Squirrel installer
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'my_electron_app',
        setupIcon: './resources/icon.ico',
        certificateFile: process.env.WINDOWS_CERT_FILE,
        certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      },
    },
    // macOS - ZIP for auto-updates
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    // macOS - DMG for distribution
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
        icon: './resources/icon.icns',
      },
    },
    // Linux - Debian package
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Your Name',
          homepage: 'https://example.com',
          icon: './resources/icon.png',
          categories: ['Utility'],
        },
      },
    },
    // Linux - RPM package
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],

  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'your-org',    // TODO: Set GitHub owner
          name: 'your-app',    // TODO: Set repo name
        },
        prerelease: false,
      },
    },
  ],

  plugins: [
    // Security: Disable dangerous Electron features
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],

  hooks: {
    postPackage: async (config, packageResult) => {
      console.log(`Packaged: ${packageResult.outputPaths.join(', ')}`);
    },
  },
};
```

## Notes

### ASAR Packaging

Setting `asar: true` bundles your application source into an ASAR archive, which prevents casual inspection of your code and slightly improves load times on Windows. The `OnlyLoadAppFromAsar` fuse further enforces that the app can only be loaded from the archive, preventing attackers from placing a plain `app/` directory alongside the binary.

### Code Signing and Notarization

macOS requires both code signing and notarization for apps distributed outside the Mac App Store. The `osxSign` block signs the binary with your Developer ID certificate, and `osxNotarize` submits it to Apple for notarization. Store credentials in environment variables (never in the config file) and configure them in your CI secrets.

For Windows, the `certificateFile` should point to your `.pfx` code signing certificate. Use an EV certificate for applications that need immediate SmartScreen trust.

### Electron Fuses

Fuses are compile-time flags baked into the Electron binary that cannot be changed at runtime. The configuration above disables several features that are unnecessary in production and could be exploited:

- **RunAsNode**: Prevents the Electron binary from being used as a plain Node.js runtime.
- **EnableNodeOptionsEnvironmentVariable**: Blocks `NODE_OPTIONS` from injecting flags.
- **EnableNodeCliInspectArguments**: Disables remote debugging via `--inspect`.
- **EnableEmbeddedAsarIntegrityValidation**: Validates the ASAR archive has not been tampered with.
- **OnlyLoadAppFromAsar**: Forces loading from the archive only.

### Universal macOS Builds

The `osxUniversal` option produces a single binary that runs natively on both Intel (x64) and Apple Silicon (arm64) Macs. The `x64ArchFiles: '*'` setting includes all x64 files in the universal binary. If you have native modules, ensure they are compiled for both architectures.

### Adding Auto-Update Support

The `maker-zip` for macOS produces the format expected by `electron-updater` or Squirrel.Mac. Pair this with the GitHub publisher to create a release-based auto-update flow. On Windows, Squirrel handles auto-updates natively. See the auto-update template for the main process integration code.

### CI/CD Integration

Run `electron-forge make` in your CI pipeline to produce platform-specific installers. Use `electron-forge publish` to upload artifacts to GitHub Releases. Ensure all signing certificates and credentials are available as CI environment variables.
