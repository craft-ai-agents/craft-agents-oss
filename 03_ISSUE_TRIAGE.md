# Phase 4 — Issue & PR Triage

## Open Issues (as of 2026-05-22)

Total: 33 open issues. Key themes:

### 🔴 Bugs (8)
| # | Title | Age |
|---|-------|-----|
| 807 | Markdown in-app preview fails & built-in browser has rendering issues on JS-heavy SPAs | 1d |
| 793 | Telegram - can't do parallel sessions because /slash commands don't 'take' until turn is over | 3d |
| 783 | OpenAI Compatible (vLLM) Connection Test Falsely Reports "No response from provider" | 5d |
| 767 | 400 Craft Agents blocked an outgoing request that the API would reject | 7d |
| 761 | Sidebar label counts are incorrect (parent ≠ children sum, mismatch with API) | 7d |
| 737 | macOS Dock icon changes appearance after launch | 12d |
| 720 | source_test connection probe reports invalid_token for OAuth MCP sources | 16d |
| 719 | WhatsApp voice messages / audio attachments are silently dropped | 16d |

### 🟡 Feature Requests (7)
| # | Title | Age |
|---|-------|-----|
| 751 | Expose custom endpoint protocol, reasoning, and model display names in UI | 9d |
| 749 | Feature Request: Compact / configurable chat input box height | 9d |
| 748 | Feature Request: Desktop App LAN / Mobile Access (Serve Web UI) | 9d |
| 746 | MiMo Token Plan Anthropic-compatible endpoint fails with 400 when thinking + tool_use history is replayed | 10d |
| 745 | Feature request: Enable WebUI from Electron Server Mode for remote browser access | 10d |
| 744 | Symlinked skill directories are not discovered by skill scanning | 10d |
| 738 | Feature Request: Session Title Language Should Respect User Preferences | 11d |

### 🟢 Tasks (9)
| # | Title | Age |
|---|-------|-----|
| 804 | Headless server stalls after source_activated: auto-retry only implemented in Electron renderer | 1d |
| 798 | Mobile WebUI — long custom provider model names cause button crowding | 2d |
| 785 | Fork Showcase: WeChat Integration, External Workspace, Mid-Session Model Switching & Cognitive Memory | 3d |
| 777 | TASK: Project linked-object navigation polish | 7d |
| 776 | TASK: Navigation and sidebar infrastructure hardening | 7d |
| 774 | TASK: Cross-object Search expansion | 7d |
| 773 | TASK: Consolidate remaining durable entity UI scaffolds | 7d |
| 736 | Automations "Run test" can hit RPC timeout while the prompt run still succeeds | 12d |
| 733 | [Feature Request] Automation: User Confirmation / Approval Card Action | 13d |

### 🔵 Already Fixed (9 labeled issues)
| # | Title | Note |
|---|-------|------|
| 727 | UI prevents switching providers if current provider has only one model | v0.9.3 |
| 720 | source_test connection probe reports invalid_token for OAuth MCP sources | v0.9.3 |
| 719 | WhatsApp voice messages / audio attachments are silently dropped | v0.9.3 |

---

## Open PRs (as of 2026-05-22)

Total: 33 open PRs. Key activity:

### 🚀 Recently Merged (3)
| # | Title | Merged |
|---|-------|--------|
| 805 | fix(server): perform source_activated auto-retry server-side | 1d ago |
| 799 | feat(messaging): add WeChat channel via iLink Bot API (QR login) | 1d ago |
| 789 | fix skills discovery for symlinked directories | 4d ago |

### 📋 Ready for Review
| # | Title | Age |
|---|-------|-----|
| 788 | Lwy dev | 4d |
| 786 | fix: correct sidebar label counts for hierarchical labels | 5d |
| 781 | feat(i18n): add Traditional Chinese (zh-Hant) locale support | 6d |
| 779 | Fix final messages not being sent over Telegram | 7d |
| 771 | fix(electron): restore spellcheck context menu | 7d |
| 765 | fix(input): hide placeholder overlay and restore text visibility during IME composition | 8d |
| 764 | fix(input): resolve Chinese IME / English auto-capitalise conflict | 8d |
| 762 | fix(pi-agent): resolve model contextWindow from Pi SDK catalog for non-Claude models | 8d |
| 760 | Add sandboxing for Anthropic sessions | 9d |
| 752 | feat(ui): configure custom endpoint protocol and model metadata | 10d |
| 750 | fix(pi): support reasoning and display names for custom endpoints | 10d |
| 734 | Fix native UI rendering with wrong color scheme on Linux/GNOME | 12d |
| 732 | feat(design): migrate chat surface to editorial-industrial tokens | 12d |
| 731 | feat(apisetup): add Manifest as a default API-key provider preset | 13d |
| 728 | Add default zoom level setting | 14d |

---

## Historical Merge Pattern (sample)

| # | Title |
|---|-------|
| 21 | Feature/ANTHROPIC_BASE_URL And claude code style config |
| 17 | Fix dock badge not clearing on app focus |
| 12 | fix(scripts): Fix Windows build scripts compatibility with bun |
| 11 | fix(ui): Fix GenericOverlay scroll issue for long content |

---

## Triage Summary

- **8 bugs** need investigation — several are high-impact (parallel Telegram sessions, vLLM false failure, sidebar counts)
- **7 feature requests** for UI/experience improvements  
- **9 task items** for infrastructure work
- **33 open PRs** with active development (WeChat integration, Traditional Chinese, sidebar counts)
- PR #805 (server-side source_activated auto-retry) just merged — closes #804
- PR #789 (symlinked skill dirs) just merged — closes #744
- i18n is active (Traditional Chinese locale PR #781 in review)

## Priority Candidates from Issues

1. **#804/#805** — Headless server source_activated stall (just merged fix)
2. **#807** — Markdown preview + browser rendering (new, high impact)
3. **#786** — Sidebar label counts (PR ready to review)
4. **#783** — vLLM false "no response" failure (real API works)
5. **#781** — Traditional Chinese i18n (PR ready, low risk)