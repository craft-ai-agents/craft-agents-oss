# Third-Party Binary Provenance

RunnerOS bundles `youtube-pp-cli` from:

- Repository: https://github.com/mvanhorn/printing-press-library
- Source package: `library/media-and-entertainment/youtube`
- Release tag: `youtube-current`
- Release URL: https://github.com/mvanhorn/printing-press-library/releases/tag/youtube-current
- License: Apache-2.0, copied in `LICENSE.youtube-pp-cli.txt`
- Notice: copied in `NOTICE.youtube-pp-cli.txt`

## Bundled Files

| RunnerOS path | Upstream asset | SHA256 |
| --- | --- | --- |
| `bin/darwin-arm64/youtube-pp-cli` | `youtube-pp-cli-darwin-arm64` | `2af09fffe34e52f759050dee93d2f8dec9f3befa8d4c644f7c58ad3af27308f2` |
| `bin/darwin-x64/youtube-pp-cli` | `youtube-pp-cli-darwin-amd64` | `b444e62541fb2775e3bd0b1f6a3f70225f3b03050deb0693db0fd457e84b5b2d` |
| `bin/linux-arm64/youtube-pp-cli` | `youtube-pp-cli-linux-arm64` | `8e73bcf0b00055ad3cf1c612d042c24e90b9e9e34c3c2fdf44b9a2a63a15a9c0` |
| `bin/linux-x64/youtube-pp-cli` | `youtube-pp-cli-linux-amd64` | `3e5ea4ebd553b040b4a5a36a3732c65c539bbb4de919409a69cf16eae1c7b3ab` |
| `bin/win32-arm64/youtube-pp-cli.exe` | `youtube-pp-cli-windows-arm64.exe` | `f2fe2cbc29da59b9fb1efd2e52d515c45bba85be24d1e01ae5e85f549b37cc7f` |
| `bin/win32-x64/youtube-pp-cli.exe` | `youtube-pp-cli-windows-amd64.exe` | `6ad3bedc45fcd9a6a4ea8d5d38d48596d12e426e4da858555a1d5a1420f48c52` |

To verify locally:

```bash
shasum -a 256 tools/youtube-research/bin/*/youtube-pp-cli*
```
