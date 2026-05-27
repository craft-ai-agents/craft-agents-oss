# Third-Party Binary Provenance

RunnerOS bundles `google-ads-pp-cli` from:

- Repository: https://github.com/mvanhorn/printing-press-library
- Source package: `library/marketing/google-ads`
- Release tag: `google-ads-current`
- Release URL: https://github.com/mvanhorn/printing-press-library/releases/tag/google-ads-current
- Upstream version: `3.10.0`
- License: Apache-2.0, copied in `LICENSE.google-ads-pp-cli.txt`
- Notice: copied in `NOTICE.google-ads-pp-cli.txt`

## Bundled Files

| RunnerOS path | Upstream asset | SHA256 |
| --- | --- | --- |
| `bin/darwin-arm64/google-ads-pp-cli` | `google-ads-pp-cli-darwin-arm64` | `20aebd8430517b740248d27ee7a69c1479ba2c62c380bea77572ef77e0ebd49d` |
| `bin/darwin-x64/google-ads-pp-cli` | `google-ads-pp-cli-darwin-amd64` | `573ce41a22986bff3434bd3d95767fa5b12b2defc7f9d8931528b0bd5f9f581b` |
| `bin/linux-x64/google-ads-pp-cli` | `google-ads-pp-cli-linux-amd64` | `f9c855c0f62b04356bbc2d4e5e5811cf24ab4e73d61dd38ab7bb1e76e61a0ffa` |
| `bin/win32-x64/google-ads-pp-cli.exe` | `google-ads-pp-cli-windows-amd64.exe` | `2d4a056d9027e9ff545c55da8124f56ae28d80c6cd3ba673f7bf1849b3a3a1fd` |

The upstream release also provides linux-arm64 and windows-arm64 assets. RunnerOS does not currently bundle those Google Ads variants.

To verify locally:

```bash
shasum -a 256 tools/google-ads/bin/*/google-ads-pp-cli*
```
