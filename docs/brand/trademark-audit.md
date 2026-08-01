# Owner Agent — Trademark and Rebrand Audit

## Legal boundary

The code is Apache-2.0 licensed, but the upstream `TRADEMARK.md` explicitly reserves “Craft” and “ARCHstudio” names, logos and branding. The fork must preserve `LICENSE`, `NOTICE`, attribution and upstream history while removing upstream trademarks from product-facing identity.

## Product-facing removals required

### Application metadata and distribution

- `apps/electron/electron-builder.yml`
  - `productName`
  - installer title
  - app descriptions
  - update URL must not silently remain on the upstream release channel
  - maintainer metadata must be replaced when an owner distribution identity exists
- `apps/electron/package.json`
  - description, author and homepage
- `apps/electron/src/main/index.ts`
  - `app.setName(...)`
- `apps/electron/src/renderer/index.html`
- `apps/electron/src/renderer/playground.html`
- Windows/macOS/Linux build scripts and output artifact names
- notification names and OS-level app identifiers

### Visible renderer brand

- splash screen
- desktop and mobile app menus
- onboarding welcome/completion/reauth/provider selection
- playground header
- provider display names currently labelled “ARCHstudio Backend”
- command-composer placeholder text
- help/documentation links
- browser and messaging preview labels

### Brand assets

Replace rather than recolour:

- `apps/electron/src/renderer/components/icons/ARCHstudioSymbol.tsx`
- `apps/electron/src/renderer/components/icons/ARCHstudioLogo.tsx`
- packaged icons under Electron resources/build assets
- tool icon entries labelled Craft Agent

The old symbols may remain only in upstream history or explicit third-party attribution—not as selectable product branding.

## References that may remain

- `LICENSE`
- `NOTICE`, updated with the new product notice while preserving upstream notice
- `TRADEMARK.md`
- third-party attribution such as “Based on the ARCHstudio open-source project”
- migration/release-history documents that clearly describe the upstream historical product
- tests where `craft.do` is deliberately a sample external URL rather than product branding

## Internal identifiers

Do not mass-rename these during the visual redesign:

- `@archstudio/*` package names
- `~/.archstudio` data directory
- `ARCHSTUDIO_*` environment variables
- protocol field names and storage schema IDs

They have compatibility and migration consequences. Rename them later behind aliases and explicit data migrations after the new UI/runtime is stable.

## Update-channel safety

Before producing an installable fork:

1. disable upstream auto-update endpoints;
2. assign a distinct app ID/product name;
3. ensure the new binary cannot overwrite or impersonate an upstream ARCHstudio installation;
4. pick a separate data directory or ship a deliberate import/migration flow;
5. sign packages under the owner’s eventual distribution identity.

## Temporary implementation identity

Until the final name is chosen:

- display name: **Owner Agent**
- internal codename: `owner-agent`
- product-facing documentation must label this as temporary
- do not publish binaries or public pages under the temporary name without an explicit naming decision
