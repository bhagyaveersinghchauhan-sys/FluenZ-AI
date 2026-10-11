import { describe, expect, it } from 'vitest';
import { readUiLanguage, translate, writeUiLanguage } from './index';

describe('interface language', () => {
  it('stores and reads only supported language choices', () => {
    const storage = window.localStorage;
    expect(writeUiLanguage('hi', storage)).toBe(true);
    expect(readUiLanguage(storage)).toBe('hi');
    storage.setItem('fluenz-ui-language-v1', 'fr');
    expect(readUiLanguage(storage)).toBeNull();
  });

  it('uses English when a Hindi translation is missing and falls back for unknown keys', () => {
    expect(translate('hi', 'progressLabelSmall')).toBe('Progress');
    expect(translate('en', 'futureTranslationKey')).toBe('futureTranslationKey');
  });

  it('does not throw when local storage is unavailable', () => {
    const storage = {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    };
    expect(readUiLanguage(storage)).toBeNull();
    expect(writeUiLanguage('en', storage)).toBe(false);
  });
});
