import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../shared/locales/en.json'
import zhTW from '../../shared/locales/zh-TW.json'
import { resolveLocale, type LanguagePreference } from '../../shared/i18n/resolveLocale'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-TW': { translation: zhTW }
  },
  lng: resolveLocale('system', navigator.language),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

// Called by App after reading the persisted language preference (Electron only).
export function applyLanguagePreference(pref: LanguagePreference): void {
  i18n.changeLanguage(resolveLocale(pref, navigator.language))
}

export default i18n
