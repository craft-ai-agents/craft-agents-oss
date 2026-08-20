# External Access — Gate 0 deployment contract

- **Status:** BLOCKED — facts missing. This file is the required worksheet, not a substitute store.
- **Date:** 2026-08-13
- **Source design:** `docs/superpowers/specs/2026-08-11-security-external-access-design.md`
- **Source plan:** `docs/superpowers/plans/2026-08-11-security-external-access-implementation-plan.md`

Logical origins (design only; not proven deployed):

| Symbol | Design value | Proven production owner |
|---|---|---|
| `APP_ORIGIN` | `app.rox.one` | **MISSING** |
| `SHARE_ORIGIN` | `share.rox.one` | **MISSING** |

Rejected as DeviceRecord stores (plan Gate 0): in-memory map, browser storage, R2 metadata, shared password.

## Gate 0 checklist

| Fact | Status | Evidence |
|---|---|---|
| Durable device-record datastore with atomic conditional update | **MISSING** | No `DeviceRecord` production adapter in tree; type exists only in the plan |
| Share-management capability issuer (aud=`share-management`) | **MISSING** | Spec/plan only |
| Local microVM image signer + digest | **MISSING** | Design requires Firecracker-class isolation; `sandbox-exec` is explicitly not enough |
| Secret authority for signing/notarization | **MISSING** | Plan forbids self-hosted `macos-toolchain` as signing boundary |
| Reverse-proxy ownership + TLS terminator | **MISSING** | Not recorded |
| App-local SPKI pin enrollment store | Partial design | Increment A can start on local Electron only; no enrolled production pins recorded here |

## Allowed next increments without this contract

- Increment A (strict remote TLS + SPKI enrollment) against **local** Electron/runtime only.
- Increment B (public messaging authority) already landed locally.
- Connection Fabric CF-1 (already landed; metadata-only). See verification below.

## Forbidden until this contract is filled

- Increment C microVM enforcement
- Increment D WebUI device authority
- Increment E public share create/revoke
- Increment F protected release signing
- Any claim that Safe/Explore `transform_data` is isolated

## Owner action required

Name: (1) device-record store product, (2) microVM image builder/signer, (3) who owns `APP_ORIGIN` / `SHARE_ORIGIN` DNS and the reverse proxy.
