import { atom } from 'jotai'
import type { Locale } from '@/i18n'

interface SettingsState {
  locale: Locale | null
}

const defaultSettings: SettingsState = {
  locale: null
}

// 从localStorage加载设置
const loadSettings = (): SettingsState => {
  try {
    const stored = localStorage.getItem('craft-agent-settings')
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
  return defaultSettings
}

// 保存设置到localStorage
const saveSettings = (settings: SettingsState) => {
  try {
    localStorage.setItem('craft-agent-settings', JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}

// 创建settings atom
export const settingsAtom = atom<SettingsState>(loadSettings())

// 创建用于更新设置的atom
export const settingsStore = {
  locale: atom(
    (get) => get(settingsAtom).locale,
    (get, set, value: Locale) => {
      const newSettings = { ...get(settingsAtom), locale: value }
      set(settingsAtom, newSettings)
      saveSettings(newSettings)
    }
  ),
  
  setLocale: atom(null, (_, set, value: Locale) => {
    const currentSettings = loadSettings()
    const newSettings = { ...currentSettings, locale: value }
    set(settingsAtom, newSettings)
    saveSettings(newSettings)
  })
}
