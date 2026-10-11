import { describe, expect, it } from 'vitest';
import {
  createSessionOptions,
  defaultPromptKey,
  isScenarioInputValid,
  scenarioPromptOptions,
  scenarioTargets,
  tutorVoiceChoices,
} from './sessionOptions';

describe('session options', () => {
  it('supports the four built-in scenarios and the documented cafe targets', () => {
    expect(Object.keys(scenarioTargets)).toEqual(['cafe', 'shop', 'introduce', 'directions', 'custom']);
    expect(scenarioTargets.cafe).toEqual(['I would like a cup of tea.', 'It is an apple.']);
    expect(Object.keys(scenarioPromptOptions)).toEqual(['cafe', 'shop', 'introduce', 'directions', 'custom']);
    expect(scenarioPromptOptions.cafe.length).toBeGreaterThan(1);
    expect(createSessionOptions('shop', defaultPromptKey.shop, 'ignored', 'en', 'default')).toEqual({
      scenario: 'shop',
      prompt_key: defaultPromptKey.shop,
      ui_language: 'en',
      voice_key: 'default',
    });
  });

  it('trims and limits custom scenarios by visible Unicode characters', () => {
    expect(isScenarioInputValid('custom', '  Ask for a bus ticket  ')).toBe(true);
    expect(createSessionOptions('custom', defaultPromptKey.custom, '  Ask for a bus ticket  ', 'hi', 'default')).toEqual({
      scenario: 'custom',
      prompt_key: defaultPromptKey.custom,
      custom_scenario: 'Ask for a bus ticket',
      ui_language: 'hi',
      voice_key: 'default',
    });

    expect(isScenarioInputValid('custom', '🙂'.repeat(200))).toBe(true);
    expect(isScenarioInputValid('custom', '🙂'.repeat(201))).toBe(false);
    expect(isScenarioInputValid('custom', '   ')).toBe(false);
    expect(isScenarioInputValid('custom', 'one\ntwo')).toBe(false);
  });

  it('sends a safe selected prompt key and rejects prompts from another scenario', () => {
    expect(createSessionOptions('cafe', 'cafe_menu', '', 'hi', 'default').prompt_key).toBe('cafe_menu');
    expect(() => createSessionOptions('shop', 'cafe_menu', '', 'en', 'default')).toThrow();
  });

  it('exposes only the server-confirmed friendly voice choice', () => {
    expect(tutorVoiceChoices).toEqual([{ key: 'default', nameKey: 'tutorVoiceDefault' }]);
    expect(() => createSessionOptions('cafe', defaultPromptKey.cafe, '', 'en', 'provider-voice-id' as 'default')).toThrow();
  });
});
