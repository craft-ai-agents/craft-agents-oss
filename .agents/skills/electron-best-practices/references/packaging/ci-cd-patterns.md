# CI/CD Patterns for Electron Apps

## Overview

Building Electron apps in CI requires a platform matrix (you cannot cross-compile
macOS apps on Linux), careful handling of signing credentials, and platform-specific
workarounds. This reference provides production-ready GitHub Actions configurations.
The same principles apply to GitLab CI, CircleCI, or Azure DevOps.

---

## Full Build and Release Workflow

```yaml
# .github/workflows/build.yml
name: Build and Release
on:
  push:
    tags: ['v*']
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
          - os: windows-latest
            platform: win32
          - os: macos-latest
            platform: darwin
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci

      - name: Setup Xvfb (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get install -y xvfb
          Xvfb :99 -screen 0 1024x768x24 &
          echo "DISPLAY=:99" >> $GITHUB_ENV

      - name: Import macOS signing certificate
        if: runner.os == 'macOS' && startsWith(github.ref, 'refs/tags/')
        env:
          CERTIFICATE_P12: ${{ secrets.CERTIFICATE_P12 }}
          CERTIFICATE_PASSWORD: ${{ secrets.CERTIFICATE_PASSWORD }}
        run: |
          echo "$CERTIFICATE_P12" | base64 --decode > certificate.p12
          security create-keychain -p "temp-password" build.keychain
          security set-keychain-settings -lut 21600 build.keychain
          security import certificate.p12 -k build.keychain \
            -P "$CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
          security set-key-partition-list -S apple-tool:,apple: \
            -s -k "temp-password" build.keychain
          security default-keychain -s build.keychain
          security list-keychains -s build.keychain login.keychain
          rm certificate.p12

      - name: Import Windows certificate
        if: runner.os == 'Windows' && startsWith(github.ref, 'refs/tags/')
        env:
          WINDOWS_CERTIFICATE_P12: ${{ secrets.WINDOWS_CERTIFICATE_P12 }}
          WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
        shell: powershell
        run: |
          $cert = [System.Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_P12)
          [System.IO.File]::WriteAllBytes("certificate.pfx", $cert)
          Import-PfxCertificate -FilePath "certificate.pfx" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -Password (ConvertTo-SecureString -String `
              $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force)
          Remove-Item "certificate.pfx"

      - name: Build
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run make

      - run: npm run test
      - run: npm run test:e2e

      - uses: actions/upload-artifact@v4
        with:
          name: build-${{ matrix.platform }}
          path: |
            out/make/**/*.dmg
            out/make/**/*.zip
            out/make/**/*.exe
            out/make/**/*.deb
            out/make/**/*.AppImage
          retention-days: 7

      - name: Cleanup macOS keychain
        if: runner.os == 'macOS' && always()
        run: security delete-keychain build.keychain 2>/dev/null || true

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
      - uses: softprops/action-gh-release@v2
        with:
          draft: true
          generate_release_notes: true
          files: artifacts/**/*.{dmg,zip,exe,deb,AppImage}
```

---

## Caching Strategies

```yaml
# Electron binary cache (in addition to setup-node npm cache)
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/electron
      ~/Library/Caches/electron
      ~/AppData/Local/electron/Cache
    key: electron-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

# Playwright browser cache
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

---

## Linux Xvfb for Headless Testing

Electron requires a display server even for headless testing:

```yaml
# Option 1: Manual setup
- run: |
    sudo apt-get install -y xvfb
    Xvfb :99 -screen 0 1024x768x24 &
    echo "DISPLAY=:99" >> $GITHUB_ENV

# Option 2: xvfb-run wrapper
- run: xvfb-run --auto-servernum npm run test:e2e

# Option 3: Dedicated action
- uses: coactions/setup-xvfb@v1
  with:
    run: npm run test:e2e
```

---

## Conditional Signing

Only sign on tag pushes (releases), not on every PR:

```javascript
// forge.config.js
const shouldSign = process.env.APPLE_ID && process.env.APPLE_PASSWORD;

module.exports = {
  packagerConfig: {
    ...(shouldSign && {
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
    }),
  },
};
```

---

## Secrets Management

| Secret | Platform | Purpose |
|--------|----------|---------|
| `CERTIFICATE_P12` | macOS | Base64-encoded .p12 signing certificate |
| `CERTIFICATE_PASSWORD` | macOS | Password for the .p12 file |
| `APPLE_ID` | macOS | Apple Developer account email |
| `APPLE_PASSWORD` | macOS | App-specific password for notarization |
| `APPLE_TEAM_ID` | macOS | Apple Developer team identifier |
| `WINDOWS_CERTIFICATE_P12` | Windows | Base64-encoded .pfx certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | Password for the .pfx file |

```bash
# Encode certificates for storage as GitHub secrets
base64 -w 0 certificate.p12 > certificate-base64.txt  # Linux
base64 -i certificate.p12 -o certificate-base64.txt    # macOS
```

---

## Publishing Strategies

```javascript
// forge.config.js - GitHub Releases
module.exports = {
  publishers: [{
    name: '@electron-forge/publisher-github',
    config: {
      repository: { owner: 'your-org', name: 'your-app' },
      draft: true,
    },
  }],
};

// forge.config.js - S3
module.exports = {
  publishers: [{
    name: '@electron-forge/publisher-s3',
    config: {
      bucket: 'your-app-releases',
      region: 'us-east-1',
      public: true,
    },
  }],
};
```

---

## Build Matrix Best Practices

```yaml
# Architecture-specific builds
strategy:
  matrix:
    include:
      - { os: ubuntu-latest, platform: linux, arch: x64 }
      - { os: ubuntu-latest, platform: linux, arch: arm64 }
      - { os: windows-latest, platform: win32, arch: x64 }
      - { os: macos-latest, platform: darwin, arch: universal }
```

Skip expensive steps on PRs:

```yaml
- name: Sign and Notarize
  if: startsWith(github.ref, 'refs/tags/')
  run: npm run sign

- name: Test  # Always run tests
  run: npm run test
```

---

## See Also

- [Code Signing](./code-signing.md) - Certificate setup and signing configuration
- [Auto Updates](./auto-updates.md) - Publishing updates that the app can consume
- [Playwright E2E Testing](../testing/playwright-e2e.md) - E2E test configuration details
