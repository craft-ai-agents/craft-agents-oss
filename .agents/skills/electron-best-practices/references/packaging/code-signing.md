# Code Signing and Notarization

## Overview

Code signing is not optional for production Electron apps. Without a valid signature,
macOS Gatekeeper blocks the application entirely, Windows SmartScreen shows a scary
"unknown publisher" warning, and enterprise IT departments will refuse to deploy
unsigned software. Notarization (macOS) adds a second layer: Apple checks your signed
app for malware and issues a ticket that Gatekeeper verifies online.

---

## macOS Code Signing

### Requirements

- An Apple Developer account ($99/year)
- A "Developer ID Application" certificate (not "Mac App Store")
- Xcode command line tools installed on the build machine
- Hardened runtime enabled (required for notarization since macOS 10.15)

### Entitlements

Electron apps need JIT and unsigned memory access for the V8 engine:

```xml
<!-- entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### Electron Forge Configuration

```javascript
// forge.config.js - macOS signing and notarization
module.exports = {
  packagerConfig: {
    osxSign: {
      identity: 'Developer ID Application: Your Name (TEAM_ID)',
      hardenedRuntime: true,
      entitlements: './entitlements.plist',
      'entitlements-inherit': './entitlements.plist',
      'gatekeeper-assess': false,
    },
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    },
  },
};
```

### Apple ID and App-Specific Password

Notarization requires: your Apple ID email, an app-specific password (generated at
appleid.apple.com), and your team ID (found in Apple Developer portal).

```bash
export APPLE_ID="developer@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password
export APPLE_TEAM_ID="ABC123DEF4"
```

### Notarization Failures

Common causes and fixes:

```
# "The signature of the binary is invalid"
# Fix: Ensure hardened runtime is enabled and entitlements are correct

# "The executable does not have the hardened runtime enabled"
# Fix: Add hardenedRuntime: true to osxSign config

# "You must first sign the relevant contracts online"
# Fix: Log into Apple Developer portal and accept pending agreements
```

### Universal Builds (arm64 + x64)

```javascript
// forge.config.js - Universal macOS build
module.exports = {
  packagerConfig: {
    osxSign: { /* ... signing config ... */ },
    osxNotarize: { /* ... notarize config ... */ },
    osxUniversal: { x64ArchFiles: '*.node' },
  },
  makers: [
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
  ],
};
```

```bash
npx electron-forge make --arch=universal --platform=darwin
```

---

## Windows Code Signing

### Certificate Types

- **Standard (OV) Certificate**: Software-based, SmartScreen warnings reduce over time
- **EV Certificate**: Immediate SmartScreen trust. Must use FIPS 140-2 Level 2 hardware
  token or cloud HSM

### Cloud-Based Signing (CI-Friendly)

Hardware tokens are impractical for CI. Use cloud services instead:

```bash
# Azure SignTool - Sign using Azure Key Vault
AzureSignTool sign \
  --azure-key-vault-url "https://your-vault.vault.azure.net" \
  --azure-key-vault-client-id "$AZURE_CLIENT_ID" \
  --azure-key-vault-client-secret "$AZURE_CLIENT_SECRET" \
  --azure-key-vault-tenant-id "$AZURE_TENANT_ID" \
  --azure-key-vault-certificate "your-cert-name" \
  --timestamp-rfc3161 "http://timestamp.digicert.com" \
  --file-digest sha256 \
  "dist/your-app-setup.exe"
```

```yaml
# DigiCert KeyLocker in GitHub Actions
- name: Sign with DigiCert KeyLocker
  env:
    SM_HOST: ${{ secrets.SM_HOST }}
    SM_API_KEY: ${{ secrets.SM_API_KEY }}
    SM_CLIENT_CERT_FILE_B64: ${{ secrets.SM_CLIENT_CERT_FILE_B64 }}
    SM_CERT_ALIAS: ${{ secrets.SM_CERT_ALIAS }}
  run: |
    echo "$SM_CLIENT_CERT_FILE_B64" | base64 --decode > /d/Certificate.p12
    smctl sign --keypair-alias $SM_CERT_ALIAS \
      --input "dist/your-app-setup.exe"
```

### Forge Windows Signing Hook

```javascript
// forge.config.js - Windows signing via postPackage hook
module.exports = {
  hooks: {
    postPackage: async (config, result) => {
      if (result.platform !== 'win32') return;
      const { execSync } = require('child_process');
      const glob = require('glob');
      const files = glob.sync('**/*.{exe,dll}', {
        cwd: result.outputPaths[0], absolute: true,
      });
      for (const file of files) {
        execSync(`AzureSignTool sign \
          --azure-key-vault-url "${process.env.AZURE_VAULT_URL}" \
          --azure-key-vault-client-id "${process.env.AZURE_CLIENT_ID}" \
          --azure-key-vault-client-secret "${process.env.AZURE_CLIENT_SECRET}" \
          --azure-key-vault-tenant-id "${process.env.AZURE_TENANT_ID}" \
          --azure-key-vault-certificate "${process.env.AZURE_CERT_NAME}" \
          --timestamp-rfc3161 "http://timestamp.digicert.com" \
          --file-digest sha256 "${file}"`);
      }
    },
  },
};
```

---

## Linux Signing

Linux does not enforce code signing at the OS level, but signing is recommended
for package managers and security-conscious users.

```bash
# GPG sign a .deb package
dpkg-sig --sign builder your-app.deb

# GPG sign an .rpm package
rpm --addsign your-app.rpm

# Sign an AppImage (produces .asc for user verification)
gpg --detach-sign --armor YourApp.AppImage
```

---

## Secure Credential Handling in CI

Never store signing credentials in code. Use CI secrets management:

```yaml
# Required GitHub Actions secrets:
# CERTIFICATE_P12       - Base64-encoded .p12 certificate
# CERTIFICATE_PASSWORD  - Password for the .p12 file
# APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID - Notarization
# AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID - Windows
```

Always clean up after signing:

```bash
security delete-keychain build.keychain 2>/dev/null || true
rm -f certificate.p12
```

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "App is damaged" on macOS | Missing or invalid signature | Rebuild with correct identity |
| Notarization timeout | Large app or Apple service delays | Retry; check Apple system status |
| Expired certificate | Certificate past validity date | Renew through Apple/CA portal |
| SmartScreen blocks EXE | No EV certificate or new cert | Use EV cert; reputation builds over time |
| "Identity not found" in CI | Keychain not configured | Import cert into CI keychain first |
| Hardened runtime crash | Missing entitlement | Add required entitlement to plist |

---

## See Also

- [CI/CD Patterns](./ci-cd-patterns.md) - Automating signing in CI pipelines
- [Auto Updates](./auto-updates.md) - Signed updates are required for secure auto-update
- [Electron Forge](../tooling/electron-forge.md) - Build tool configuration for signing
