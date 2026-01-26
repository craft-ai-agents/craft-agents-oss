/**
 * Claude Profiles Atoms
 *
 * Jotai atoms for managing Claude multi-account profiles state.
 */

import { atom } from 'jotai';
import type {
  ClaudeProfile,
  ClaudeUsageData,
  ClaudeAutoSwitchSettings,
  ClaudeProfileScore,
} from '../../shared/types';

// ============================================
// State Types
// ============================================

interface ProfilesState {
  items: ClaudeProfile[];
  activeId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface AutoSwitchState {
  settings: ClaudeAutoSwitchSettings | null;
  isLoading: boolean;
}

interface MonitoringState {
  isActive: boolean;
}

// ============================================
// Base Atoms
// ============================================

/** Main profiles state atom */
export const profilesAtom = atom<ProfilesState>({
  items: [],
  activeId: null,
  isLoading: false,
  error: null,
});

/** Auto-switch settings atom */
export const autoSwitchAtom = atom<AutoSwitchState>({
  settings: null,
  isLoading: false,
});

/** Monitoring state atom */
export const monitoringAtom = atom<MonitoringState>({
  isActive: false,
});

// ============================================
// Derived Atoms
// ============================================

/** Get the active profile */
export const activeProfileAtom = atom((get) => {
  const state = get(profilesAtom);
  if (!state.activeId) return null;
  return state.items.find((p) => p.id === state.activeId) ?? null;
});

/** Get the default profile */
export const defaultProfileAtom = atom((get) => {
  const state = get(profilesAtom);
  return state.items.find((p) => p.isDefault) ?? null;
});

/** Get profiles sorted by usage (least used first) */
export const sortedProfilesAtom = atom((get) => {
  const state = get(profilesAtom);
  return [...state.items].sort((a, b) => {
    // Active profile first
    if (a.id === state.activeId) return -1;
    if (b.id === state.activeId) return 1;
    // Default second
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    // Then by usage (lower usage = better)
    const aUsage = a.usage?.fiveHourUtilization ?? 0;
    const bUsage = b.usage?.fiveHourUtilization ?? 0;
    return aUsage - bUsage;
  });
});

// ============================================
// Action Atoms
// ============================================

/** Load all profiles */
export const loadProfilesAtom = atom(null, async (get, set) => {
  set(profilesAtom, { ...get(profilesAtom), isLoading: true, error: null });
  try {
    const [items, activeId] = await Promise.all([
      window.electronAPI.claudeProfilesList(),
      window.electronAPI.claudeProfilesGetActiveId(),
    ]);
    set(profilesAtom, { items, activeId, isLoading: false, error: null });
  } catch (error) {
    set(profilesAtom, {
      items: [],
      activeId: null,
      isLoading: false,
      error: error instanceof Error ? error.message : 'Failed to load profiles',
    });
  }
});

/** Start OAuth flow for new profile */
export const startOAuthAtom = atom(
  null,
  async (_get, _set, profileName: string) => {
    const result = await window.electronAPI.claudeProfilesStartOAuth(profileName);
    // Open the auth URL in the browser
    await window.electronAPI.openUrl(result.authUrl);
    return result;
  }
);

/** Complete OAuth flow */
export const completeOAuthAtom = atom(
  null,
  async (get, set, { code, state }: { code: string; state: string }) => {
    const profile = await window.electronAPI.claudeProfilesCompleteOAuth(code, state);
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: [...current.items, profile],
      activeId: current.activeId ?? profile.id,
    });
    return profile;
  }
);

/** Update profile */
export const updateProfileAtom = atom(
  null,
  async (get, set, { profileId, updates }: { profileId: string; updates: { name?: string } }) => {
    const profile = await window.electronAPI.claudeProfilesUpdate(profileId, updates);
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: current.items.map((p) => (p.id === profileId ? profile : p)),
    });
    return profile;
  }
);

/** Delete profile */
export const deleteProfileAtom = atom(null, async (get, set, profileId: string) => {
  await window.electronAPI.claudeProfilesDelete(profileId);
  const current = get(profilesAtom);
  const newItems = current.items.filter((p) => p.id !== profileId);
  set(profilesAtom, {
    ...current,
    items: newItems,
    activeId: current.activeId === profileId ? (newItems[0]?.id ?? null) : current.activeId,
  });
});

/** Set active profile */
export const setActiveProfileAtom = atom(null, async (get, set, profileId: string) => {
  await window.electronAPI.claudeProfilesSetActive(profileId);
  const current = get(profilesAtom);
  set(profilesAtom, {
    ...current,
    activeId: profileId,
  });
});

/** Set default profile */
export const setDefaultProfileAtom = atom(null, async (get, set, profileId: string) => {
  await window.electronAPI.claudeProfilesSetDefault(profileId);
  const current = get(profilesAtom);
  set(profilesAtom, {
    ...current,
    items: current.items.map((p) => ({
      ...p,
      isDefault: p.id === profileId,
    })),
  });
});

/** Poll usage for a profile */
export const pollProfileUsageAtom = atom(
  null,
  async (get, set, profileId: string) => {
    const usage = await window.electronAPI.claudeProfilesPollUsage(profileId);
    if (!usage) return null;

    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: current.items.map((p) =>
        p.id === profileId ? { ...p, usage, lastMonitoredAt: Date.now() } : p
      ),
    });
    return usage;
  }
);

// ============================================
// Auto-Switch Atoms
// ============================================

/** Load auto-switch settings */
export const loadAutoSwitchSettingsAtom = atom(null, async (get, set) => {
  set(autoSwitchAtom, { ...get(autoSwitchAtom), isLoading: true });
  try {
    const settings = await window.electronAPI.claudeProfilesGetAutoSwitchSettings();
    set(autoSwitchAtom, { settings, isLoading: false });
  } catch (error) {
    console.error('Failed to load auto-switch settings:', error);
    set(autoSwitchAtom, { settings: null, isLoading: false });
  }
});

/** Update auto-switch settings */
export const updateAutoSwitchSettingsAtom = atom(
  null,
  async (get, set, updates: Partial<ClaudeAutoSwitchSettings>) => {
    await window.electronAPI.claudeProfilesUpdateAutoSwitchSettings(updates);
    const current = get(autoSwitchAtom);
    if (current.settings) {
      set(autoSwitchAtom, {
        ...current,
        settings: { ...current.settings, ...updates },
      });
    }
  }
);

// ============================================
// Monitoring Atoms
// ============================================

/** Start usage monitoring */
export const startMonitoringAtom = atom(null, async (get, set) => {
  await window.electronAPI.claudeProfilesStartMonitoring();
  set(monitoringAtom, { isActive: true });
});

/** Stop usage monitoring */
export const stopMonitoringAtom = atom(null, async (get, set) => {
  await window.electronAPI.claudeProfilesStopMonitoring();
  set(monitoringAtom, { isActive: false });
});

/** Check monitoring status */
export const checkMonitoringAtom = atom(null, async (get, set) => {
  const isActive = await window.electronAPI.claudeProfilesIsMonitoring();
  set(monitoringAtom, { isActive });
});

// ============================================
// Event Handler Setup
// ============================================

/** Setup event listeners for profile updates */
export const setupProfileEventsAtom = atom(null, (get, set) => {
  // Profile created
  const unsubCreated = window.electronAPI.onClaudeProfileCreated(({ profile }) => {
    const current = get(profilesAtom);
    if (!current.items.find((p) => p.id === profile.id)) {
      set(profilesAtom, {
        ...current,
        items: [...current.items, profile],
      });
    }
  });

  // Profile updated
  const unsubUpdated = window.electronAPI.onClaudeProfileUpdated(({ profile }) => {
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: current.items.map((p) => (p.id === profile.id ? profile : p)),
    });
  });

  // Profile deleted
  const unsubDeleted = window.electronAPI.onClaudeProfileDeleted(({ profileId }) => {
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: current.items.filter((p) => p.id !== profileId),
      activeId: current.activeId === profileId ? null : current.activeId,
    });
  });

  // Active changed
  const unsubActiveChanged = window.electronAPI.onClaudeProfileActiveChanged(({ profileId }) => {
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      activeId: profileId,
    });
  });

  // Usage updated
  const unsubUsageUpdated = window.electronAPI.onClaudeProfileUsageUpdated(({ profileId, usage }) => {
    const current = get(profilesAtom);
    set(profilesAtom, {
      ...current,
      items: current.items.map((p) =>
        p.id === profileId ? { ...p, usage, lastMonitoredAt: Date.now() } : p
      ),
    });
  });

  // Return cleanup function
  return () => {
    unsubCreated();
    unsubUpdated();
    unsubDeleted();
    unsubActiveChanged();
    unsubUsageUpdated();
  };
});
