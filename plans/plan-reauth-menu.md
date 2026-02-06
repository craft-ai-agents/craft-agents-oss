## Plan: Add “Re-authenticate” menu action (always visible) and launch OAuth directly

### Goals
- Add a **“Re-authenticate”** item to the connection “…” menu that is **always visible**.
- Clicking it should **open the OAuth flow immediately** for OAuth-based connections (Claude Max / ChatGPT).
- For non‑OAuth connections, fall back to opening the edit flow (so users can update API keys).

### Steps
1. **Extend onboarding OAuth handler**
   - Update `useOnboarding` to allow `handleStartOAuth(methodOverride?: ApiSetupMethod)`.
   - If a method override is provided, set `apiSetupMethod`, move to `credentials` step, and then launch OAuth.
   - Keep existing behavior for in‑wizard calls (no argument).

2. **Broaden handler type signatures**
   - Update types in `OnboardingWizard` and `CredentialsStep` so `onStartOAuth` accepts an optional method parameter.
   - No behavior change for existing UI paths.

3. **Add “Re-authenticate” menu action**
   - In `AiSettingsPage.tsx`, add `onReauthenticate` to `ConnectionRow` props and render a menu item above “Validate Connection”.
   - Implement a handler that:
     - Opens the API setup overlay,
     - Resets onboarding state,
     - If `authType === 'oauth'`, calls `handleStartOAuth` with `claude_oauth` or `chatgpt_oauth` based on `providerType`,
     - Otherwise falls back to the edit flow (API key).

### Files to touch
- `apps/electron/src/renderer/hooks/useOnboarding.ts`
- `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`
- `apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx`
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx`

---
If you approve, I’ll implement these changes.
