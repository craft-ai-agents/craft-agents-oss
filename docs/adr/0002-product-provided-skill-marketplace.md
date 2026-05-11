# ADR 0002 — Product-provided Skill Marketplace

**Status:** Accepted

## Context

Local Skills are installed into local skill storage and are the only skills available for use in sessions. We want users to share skills publicly through a product-provided catalog without making remote skills execute directly from the network or letting users configure arbitrary marketplace servers.

## Decision

Create a first-class **Skill Marketplace** backed by a separate hosted service, with the app acting as a client. Users see one product Marketplace; development/internal builds may switch service environments for testing. Marketplace browsing is anonymous, while publishing and installing require authentication.

Marketplace Skills are public, user-owned, and published immediately after stricter validation. Each Marketplace Skill has a stable Marketplace ID separate from its Skill Slug; names can change, marketplace slugs stay stable, and published versions are immutable SemVer releases containing a full skill directory bundle. Owners can unpublish Marketplace Skills from discovery, but published versions are not hard-deleted.

Marketplace Skills become usable only after explicit installation into Local Skills. Installation copies the bundle into local skill storage, stores marketplace origin/version metadata beside it, tracks the install on the hosted service, and never auto-updates. Users can manually update installed Marketplace Skills; local edits mark the Local Skill as modified and update warns before overwriting local changes.

The hosted service exposes a REST-style JSON API for metadata and lifecycle actions, with separate HTTP upload/download endpoints for zip skill bundles. v1 uses direct multipart upload to the Marketplace API rather than pre-signed object storage uploads.

Publish requests include the zip bundle plus required marketplace slug, SemVer version, and product-defined category. Tags, release notes, and “based on” origin fields are optional.

The published bundle's `SKILL.md` frontmatter is the source of truth for skill name and description; the Marketplace API derives listing name and description from the bundle instead of accepting duplicate request fields.

The client suggests the initial marketplace slug from the `SKILL.md` name, but the user can edit it before first publication. After publication, marketplace slugs remain stable.

Marketplace slugs are globally unique. A publish request for an existing slug is accepted only when the authenticated user owns that Marketplace Skill and is publishing a new immutable version.

The app checks marketplace-installed Local Skills for updates with a batch endpoint that accepts installed Marketplace IDs and versions and returns update, unpublished, or unavailable status per skill. Owner-unpublished Marketplace Skills remain installed locally but stop receiving updates; admin-unpublished skills are kept locally but marked safety-blocked with a stronger warning.

Marketplace install uses an authenticated install-intent/install-complete flow: the app requests an install intent and receives a short-lived bundle download URL, installs the bundle into Local Skills, then records install completion only after the local install succeeds.

Marketplace updates use the same intent/download/complete flow as installs, recording completion only after the local update succeeds.

Local marketplace metadata is stored beside installed bundles and includes marketplace ID, marketplace slug, owner ID, owner display-name snapshot, installed version, installed timestamp, last checked timestamp, modified flag, source bundle hash, optional based-on origin, and safety status.

The Marketplace API computes and exposes SHA-256 bundle hashes for published versions so the app can verify downloads and detect local modification.

Update checks use SemVer to identify newer versions and hashes to detect integrity anomalies for immutable versions.

The app downloads Marketplace bundles to temporary storage and verifies the expected SHA-256 hash before writing install or update files into Local Skills.

The app reports Marketplace bundle integrity failures back to the hosted service.

## Consequences

- Marketplace availability is isolated from Local Skills; Marketplace outages only affect Marketplace surfaces.
- Direct **Publish Skill** supports Create, Upload, and Remote paths, but publishes only and does not install locally.
- AI Assist remains Local Skill-first; AI-created Local Skills can be published later.
- Non-owner edits to marketplace-installed Local Skills publish as a new Marketplace Skill, with “based on” attribution when origin metadata is available.
- Public-only publishing requires post-publication safety controls: report actions and admin unpublish.
