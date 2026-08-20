# Spec slice: OwnedRootPolicy (not implemented)

- **Status:** Partial — `getConfigDir()` + injectable adapter + absolute import-path gate landed. Default remains `~/.craft-agent`, not `~/ROX`.
- **Parent:** `docs/superpowers/specs/2026-08-13-post-research-program.md`
- **HTML:** `$TMPDIR/architecture-review-20260813.html` candidate `root-policy`

## Objective

Replace module-eval `CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || ~/.craft-agent` with one deep module that resolves owned roots **after** process boot, injectable in tests.

## Out of scope

- ROX Notes Imports implementation
- SiYuan managed kernel
- Moving existing user workspaces automatically

## Success criteria (when authorized)

- Production default owned state is not captured at import time
- Tests inject a root adapter; they do not depend on `CRAFT_CONFIG_DIR` as a production fallback
- Existing explicit `Workspace.rootPath` / `notesPath` remain user choices

Blocked on owner pick + Notes security acceptance if the default becomes `~/ROX`.
