import type { OwnerProfile } from '@archstudio/core';
import type { UserPreferences } from '../config/preferences.ts';
import { DEFAULT_OWNER_PROFILE } from './schema.ts';

/**
 * Migration routine: Converts legacy UserPreferences into the new layered OwnerProfile structure.
 * Leaves the old preferences file untouched.
 */
export function migratePreferencesToOwnerProfile(prefs: UserPreferences): OwnerProfile {
  const profile = { ...DEFAULT_OWNER_PROFILE };

  if (prefs.name) {
    profile.identity.name = prefs.name;
    // Add old name to aliases if it's not already there
    if (!profile.identity.aliases.includes(prefs.name)) {
      profile.identity.aliases.push(prefs.name);
    }
  }

  if (prefs.timezone) {
    profile.identity.timezone = prefs.timezone;
  }

  if (prefs.uiLanguage) {
    profile.identity.locale = prefs.uiLanguage;
  }

  // If there are legacy notes, we can map them or keep a record.
  // The plans mention: "consolidate / import legacy notes or memory".
  // For the profile, let's keep it clean, but if we need a custom field or comment:
  // We can add it as a custom detail, but standard schema doesn't have a notes field.
  // Thus we preserve the schema structure strictly.

  profile.updatedAt = Date.now();
  return profile;
}
