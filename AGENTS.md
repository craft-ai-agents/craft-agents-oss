# AGENTS.md

Guidance for AI coding agents working in this repository.

## Windows: pre-commit hooks need Git's bundled bash

The husky pre-commit hooks (`bun scripts/check-*`, etc.) are POSIX shell scripts
(`#!/usr/bin/env sh`). When running `git commit` from an agent on Windows, Git
resolves the hook's shebang through `PATH`, and `C:\WINDOWS\system32\bash.exe`
(the WSL relay, which has no distro installed) will be picked up instead of the
real Git shell, causing hooks to fail with:

```
WSL (Relay) ERROR: CreateProcessCommon: execvpe(/bin/bash) failed: No such file or directory
```

To fix, prepend Git's bundled `bin` and `usr/bin` to `PATH` before committing:

```powershell
$env:PATH = "C:\Program Files\Git\bin;C:\Program Files\Git\usr\bin;" + $env:PATH
git commit -m "..."
```

Do NOT skip hooks (`--no-verify`) to work around this — fix the PATH instead.
