/**
 * i18next-scanner configuration
 *
 * Scans TypeScript/React files for t() calls and extracts translation keys
 * into JSON files for each namespace.
 */

module.exports = {
  input: [
    'apps/electron/src/renderer/**/*.{ts,tsx}',
    // Exclude test files and node_modules
    '!apps/electron/src/renderer/**/*.spec.{ts,tsx}',
    '!apps/electron/src/renderer/**/__tests__/**',
    '!**/node_modules/**',
  ],
  output: './apps/electron/public/locales',
  options: {
    debug: false,
    removeUnusedKeys: false, // Keep unused keys to avoid accidental deletions
    sort: true, // Sort keys alphabetically

    // Translation function names to look for
    func: {
      list: ['t', 'i18next.t', 'i18n.t'],
      extensions: ['.ts', '.tsx'],
    },

    // Internationalization library
    lngs: ['en', 'fr'],
    defaultLng: 'en',
    defaultNs: 'common',

    // Namespace configuration
    ns: [
      'common',
      'chat',
      'settings',
      'onboarding',
      'shortcuts',
      'auth',
      'errors',
    ],

    // Default value for missing translations
    defaultValue: (lng, ns, key) => {
      if (lng === 'en') {
        // For English, return the key itself as a placeholder
        return key;
      }
      // For other languages, return empty string (will be filled by translation)
      return '';
    },

    // Resource configuration
    resource: {
      loadPath: '{{lng}}/{{ns}}.json',
      savePath: '{{lng}}/{{ns}}.json',
      jsonIndent: 2,
      lineEnding: '\n',
    },

    // Namespace separator
    nsSeparator: ':',

    // Key separator for nested keys
    keySeparator: '.',

    // Interpolation configuration
    interpolation: {
      prefix: '{{',
      suffix: '}}',
    },
  },
};
