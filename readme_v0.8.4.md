# Craft Agents v0.8.4 - Chinese Language Support Release

## Overview

This release introduces comprehensive Chinese language support for the Craft Agents desktop application, making it accessible to Chinese-speaking users.

## New Features

### Chinese Language Support

- **Language Switcher**: Added a language toggle in Settings > Preferences, allowing users to switch between English and Chinese
- **Complete UI Translation**: Most of the user interface has been translated to Chinese, including:
  - Sidebar navigation and menu items
  - Settings pages (Appearance, Input, Labels, Permissions, Server, Shortcuts, Workspace, AI)
  - Automations components and UI
  - Session management
  - Preferences and configuration

### Internationalization System

- Implemented a robust i18n (internationalization) system
- Uses `useTranslations()` hook for React components
- Translation files located in `apps/electron/src/renderer/i18n/locales/`:
  - `en-US.ts` - English translations
  - `zh-CN.ts` - Chinese translations

## Technical Improvements

- Fixed tsconfig configuration issues (`tsconfig.base.json` not found)
- Updated multiple package tsconfig files to use proper TypeScript configuration without base extends
- Improved type safety throughout the codebase

## Known Limitations

### Incomplete Translations

While most of the UI has been translated, some parts of the application are still in English:

- **AppMenu component**: The application menu bar (top menu on macOS, or menu dropdown on Windows/Linux) has not been fully translated
- **Minor UI elements**: Some smaller UI elements and edge cases may still display English text
- **Error messages**: Certain error messages and system notifications may remain in English

### Areas for Future Improvement

1. **AppMenu Translation**: Complete the translation of the application menu bar
2. **Error Messages**: Translate all error messages and system notifications
3. **Edge Cases**: Identify and translate any remaining untranslated UI elements
4. **Contextual Translation**: Improve translation accuracy for technical terms and domain-specific language

## Installation & Usage

### Switching Language

1. Open Craft Agents
2. Go to Settings > Preferences
3. Find the "Language" dropdown menu
4. Select "中文 (Chinese)" to switch to Chinese, or "English" to switch back

### Building from Source

```bash
git clone https://github.com/lukilabs/craft-agents-oss.git
cd craft-agents-oss
bun install
bun run electron:start
```

## Contributing

Contributions to complete the Chinese language support are welcome! If you'd like to help with translations or improve the existing ones:

1. Check the translation files in `apps/electron/src/renderer/i18n/locales/`
2. Add missing translations or improve existing ones
3. Submit a pull request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
