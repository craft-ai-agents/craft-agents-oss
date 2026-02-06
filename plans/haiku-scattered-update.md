# Plan: Update scattered model references (no registry changes)

1. Update UI model pickers and fallback descriptions to use `claude-haiku-4-5-20251001` and keep other existing IDs unchanged.
2. Update docs to reflect `claude-haiku-4-5-20251001` (no `-latest`), and keep Opus/Sonnet IDs as-is.
3. Replace hard-coded Codex fallback IDs in UI/runtime with shared constants where possible (without modifying the registry itself).
4. Summarize changed files and provide a quick review checklist.
