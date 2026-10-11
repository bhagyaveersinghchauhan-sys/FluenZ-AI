import en from './en';
import hi from './hi';

export type UiLanguage = 'en' | 'hi';
export type TranslationKey = keyof typeof en;
export type TranslationValues = Record<string, string | number>;

const dictionaries: Record<UiLanguage, Record<string, string>> = { en, hi };
const languageStorageKey = 'fluenz-ui-language-v1';

export function translate(
  language: UiLanguage,
  key: string,
  values: TranslationValues = {},
): string {
  const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function readUiLanguage(
  storage?: Pick<Storage, 'getItem'>,
): UiLanguage | null {
  try {
    const value = (storage ?? globalThis.localStorage).getItem(languageStorageKey);
    return value === 'en' || value === 'hi' ? value : null;
  } catch {
    return null;
  }
}

export function writeUiLanguage(
  language: UiLanguage,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    (storage ?? globalThis.localStorage).setItem(languageStorageKey, language);
    return true;
  } catch {
    return false;
  }
}
