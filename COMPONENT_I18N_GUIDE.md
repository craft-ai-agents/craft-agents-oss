# Component Translation Guide

## Overview

This guide shows how to update React components to use the i18n translation system. The AppShell component has been updated as a reference example.

## Quick Steps

### 1. Add Import

At the top of your component file, add:

```tsx
import { useTranslation } from "@/i18n"
```

### 2. Add Hook Call

Inside your component function, add the translation hook:

```tsx
function MyComponent() {
  const { t } = useTranslation()

  // ... rest of component
}
```

### 3. Replace Hardcoded Strings

Replace hardcoded strings with `t()` calls:

**Before:**
```tsx
<Button>Delete</Button>
<span>No conversations found</span>
```

**After:**
```tsx
<Button>{t('delete' as any)}</Button>
<span>{t('noConversationsFound' as any)}</span>
```

## Common Patterns

### Button Labels

**Before:**
```tsx
<Button onClick={handleSave}>Save</Button>
<Button onClick={handleCancel}>Cancel</Button>
```

**After:**
```tsx
<Button onClick={handleSave}>{t('save' as any)}</Button>
<Button onClick={handleCancel}>{t('cancel' as any)}</Button>
```

### Toast Messages

**Before:**
```tsx
toast.success('Link copied to clipboard')
toast.error('Failed to share')
```

**After:**
```tsx
toast.success(t('linkCopiedToClipboard' as any))
toast.error(t('failedToShare' as any))
```

### Empty States

**Before:**
```tsx
<div className="empty-state">
  <p>No conversations yet</p>
  <button>Create your first chat</button>
</div>
```

**After:**
```tsx
<div className="empty-state">
  <p>{t('noConversationsYet' as any)}</p>
  <button>{t('newChat' as any)}</button>
</div>
```

### User-Generated Content (IMPORTANT!)

**NEVER translate user content!** Use the `<UserContent>` component:

**Before:**
```tsx
<div>
  Conversation: {session.name}
</div>
```

**After:**
```tsx
import { UserContent } from '@/components/ui/UserContent'

<div>
  {t('conversation' as any)}: <UserContent content={session.name} />
</div>
```

### With Interpolation (Parameters)

For strings with dynamic values (like names, counts):

**Before:**
```tsx
const message = `Delete ${session.name}? This cannot be undone.`
```

**After:**
```tsx
import { sanitizeUserInput } from '@/lib/sanitization'

// CRITICAL: Sanitize user input BEFORE interpolation
const sanitizedName = sanitizeUserInput(session.name)
const message = t('deleteConversationMessage' as any, { name: sanitizedName })
```

## Available Translation Keys

Current keys available (see `src/renderer/i18n/locales/en.ts`):

### Navigation
- `allChats` - "All Chats"
- `settings` - "Settings"
- `flagged` - "Flagged"
- `sources` - "Sources"
- `skills` - "Skills"
- `workspace` - "Workspace"

### Actions
- `newChat` - "New Chat"
- `delete` - "Delete"
- `cancel` - "Cancel"
- `save` - "Save"
- `confirm` - "Confirm"
- `continue` - "Continue"
- `back` - "Back"
- `skip` - "Skip"
- `allow` - "Allow"
- `deny` - "Deny"
- `copy` - "Copy"
- `open` - "Open"
- `close` - "Close"
- `rename` - "Rename"
- `share` - "Share"
- `refresh` - "Refresh"
- `edit` - "Edit"
- `done` - "Done"

### Session Management
- `deleteConversation` - "Delete conversation"
- `deleteConversationTitle` - "Delete conversation"
- `deleteConversationMessage` - "Are you sure you want to delete "{{name}}"? This action cannot be undone."
- `conversationDeleted` - "Conversation deleted"
- `renameConversation` - "Rename conversation"
- `untitled` - "Untitled"
- `noConversationsYet` - "No conversations yet"
- `noSessionSelected` - "No session selected"
- `loadingSession` - "Loading session..."

### Empty States
- `noSourcesConfigured` - "No sources configured"
- `noSkillsConfigured` - "No skills configured"
- `noConversationsFound` - "No conversations found"

### Toast Messages
- `linkCopiedToClipboard` - "Link copied to clipboard"
- `failedToShare` - "Failed to share"
- `titleRefreshed` - "Title refreshed"
- `workspaceCreated` - "Workspace created"
- `settingsSaved` - "Settings saved"
- `failedToCopyPattern` - "Failed to copy pattern"
- `patternCopiedToClipboard` - "Pattern copied to clipboard"
- `shareUpdated` - "Share updated"
- `failedToUpdateShare` - "Failed to update share"
- `sharingStopped` - "Sharing stopped"
- `failedToStopSharing` - "Failed to stop sharing"
- `deletedSource` - "Deleted source"
- `failedToDeleteSource` - "Failed to delete source"
- `deletedSkill` - "Deleted skill: {{name}}"
- `invalidLink` - "Invalid link"

### Status Labels
- `todo` - "Todo"
- `inProgress` - "In Progress"
- `needsReview` - "Needs Review"
- `processing` - "Processing..."
- `complete` - "Complete"
- `errorStatus` - "Error"

### Error Messages
- `unknownError` - "Unknown error"
- `networkRequestFailed` - "Network request failed"
- `invalidCredentials` - "Invalid credentials"
- `sessionExpired` - "Session expired"

### Date/Time
- `today` - "Today"
- `yesterday` - "Yesterday"
- `hoursAgo` - "{{count}} hours ago"
- `daysAgo` - "{{count}} days ago"
- `minutesAgo` - "{{count}} minutes ago"
- `secondsAgo` - "{{count}} seconds ago"

### Onboarding
- `welcomeToCraftAgents` - "Welcome to Craft Agents"
- `getStarted` - "Get Started"

## Adding New Translation Keys

If you need a translation key that doesn't exist yet:

### 1. Add to English translations

Edit `src/renderer/i18n/locales/en.ts`:

```typescript
export default {
  // ... existing keys
  myNewKey: 'My new text',
} as const;
```

### 2. Add to Chinese translations

Edit `src/renderer/i18n/locales/zh.ts`:

```typescript
export default {
  // ... existing keys
  myNewKey: '我的新文本',
} as const;
```

### 3. Use in component

```tsx
<span>{t('myNewKey' as any)}</span>
```

## Example: Complete Component Update

Here's a complete example showing before and after:

**Before (with hardcoded strings):**
```tsx
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

function SessionActions({ session }) {
  const handleDelete = () => {
    if (confirm(`Delete ${session.name}?`)) {
      // Delete logic
      toast.success('Conversation deleted')
    }
  }

  return (
    <div>
      <h2>Session Actions</h2>
      <Button onClick={handleDelete}>Delete</Button>
      <Button onClick={handleRename}>Rename</Button>
      <Button onClick={handleShare}>Share</Button>
    </div>
  )
}
```

**After (with translations):**
```tsx
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useTranslation } from "@/i18n"
import { sanitizeUserInput } from "@/lib/sanitization"
import { UserContent } from "@/components/ui/UserContent"

function SessionActions({ session }) {
  const { t } = useTranslation()

  const handleDelete = () => {
    // Sanitize user input before interpolation
    const sanitizedName = sanitizeUserInput(session.name)
    if (confirm(t('deleteConversationMessage' as any, { name: sanitizedName }))) {
      // Delete logic
      toast.success(t('conversationDeleted' as any))
    }
  }

  return (
    <div>
      <h2>{t('deleteConversation' as any)}</h2>
      <Button onClick={handleDelete}>{t('delete' as any)}</Button>
      <Button onClick={handleRename}>{t('rename' as any)}</Button>
      <Button onClick={handleShare}>{t('share' as any)}</Button>
      {/* User content stays as-is */}
      <UserContent content={session.name} />
    </div>
  )
}
```

## Component Priority List

Update components in this order:

### ✅ Phase 3a: High Priority (Completed)
- [x] AppShell - Navigation labels

### 🔄 Phase 3b: High Priority (Next)
- [ ] SessionList - Empty states, toast messages
- [ ] SessionMenu - Delete, rename, share actions
- [ ] Settings pages - All settings labels

### 📋 Phase 3c: Medium Priority
- [ ] Onboarding components
- [ ] Chat components
- [ ] Toast notification components
- [ ] Dialog/Modal components

### 📝 Phase 3d: Low Priority
- [ ] Utility components
- [ ] Playground components
- [ ] Test components

## Security Checklist

For each component, verify:

- [ ] User-generated content uses `<UserContent>` component
- [ ] User input is sanitized before interpolation
- [ ] No `t()` calls on user-provided data
- [ ] All hardcoded strings replaced with `t()` calls
- [ ] Translation keys exist in both en.ts and zh.ts

## Testing Checklist

After updating a component:

- [ ] Component displays correctly in English
- [ ] Component displays correctly in Chinese
- [ ] Language switch works (no mixed-language states)
- [ ] User content is NOT translated
- [ ] No console errors
- [ ] TypeScript compilation succeeds

## Finding Hardcoded Strings

Use these commands to find remaining hardcoded strings:

```bash
# Find all hardcoded strings in TSX files
grep -r "\".*\"" src/renderer/components --include="*.tsx" | grep -v "t('" | head -50

# Find toast messages
grep -r "toast\." src/renderer/components --include="*.tsx" | grep -E '\.(success|error|info)\('

# Find button labels
grep -r "<Button.*>.*<" src/renderer/components --include="*.tsx"
```

## Need Help?

- Reference implementation: `src/renderer/components/app-shell/AppShell.tsx` (completed)
- Translation files: `src/renderer/i18n/locales/en.ts` and `zh.ts`
- Component examples: `src/renderer/components/ui/LanguageSwitcher.tsx`

---

**Last Updated:** 2026-01-21
**Status:** Phase 3a Complete ✅ | Phase 3b-3d In Progress 🔄
