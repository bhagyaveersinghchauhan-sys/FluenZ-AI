import type { UiLanguage } from './i18n';

export type ScenarioId = 'cafe' | 'shop' | 'introduce' | 'directions' | 'custom';
export type VoiceKey = 'default';
export type PromptKey =
  | 'cafe_classic' | 'cafe_tea' | 'cafe_menu' | 'cafe_bill'
  | 'shop_classic' | 'shop_size' | 'shop_payment'
  | 'introduce_classic' | 'introduce_origin' | 'introduce_work'
  | 'directions_classic' | 'directions_bus' | 'directions_landmark'
  | 'custom_help' | 'custom_clarify';

export type SessionOptions = {
  scenario: ScenarioId;
  prompt_key: PromptKey;
  custom_scenario?: string;
  ui_language: UiLanguage;
  voice_key: VoiceKey;
};

export type PromptOption = {
  key: PromptKey;
  labelKey: string;
  cueKey: string;
  targetKeys: readonly [string, string];
  targets: readonly [string, string];
};

export const tutorVoiceChoices: readonly { key: VoiceKey; nameKey: string }[] = [
  { key: 'default', nameKey: 'tutorVoiceDefault' },
];

export const scenarioPromptOptions: Record<ScenarioId, readonly PromptOption[]> = {
  cafe: [
    { key: 'cafe_classic', labelKey: 'promptCafeClassic', cueKey: 'promptCafeClassicCue', targetKeys: ['promptCafeClassicTarget1', 'promptCafeClassicTarget2'], targets: ['I would like a cup of tea.', 'It is an apple.'] },
    { key: 'cafe_tea', labelKey: 'promptCafeTea', cueKey: 'promptCafeTeaCue', targetKeys: ['promptCafeTeaTarget1', 'promptCafeTeaTarget2'], targets: ['I would like a cup of tea, please.', 'Could I have it without sugar?'] },
    { key: 'cafe_menu', labelKey: 'promptCafeMenu', cueKey: 'promptCafeMenuCue', targetKeys: ['promptCafeMenuTarget1', 'promptCafeMenuTarget2'], targets: ['Could I see the menu, please?', 'What would you recommend?'] },
    { key: 'cafe_bill', labelKey: 'promptCafeBill', cueKey: 'promptCafeBillCue', targetKeys: ['promptCafeBillTarget1', 'promptCafeBillTarget2'], targets: ['Could I have the bill, please?', 'How much does it cost?'] },
  ],
  shop: [
    { key: 'shop_classic', labelKey: 'promptShopClassic', cueKey: 'promptShopClassicCue', targetKeys: ['promptShopClassicTarget1', 'promptShopClassicTarget2'], targets: ['I would like to buy this.', 'How much is it?'] },
    { key: 'shop_size', labelKey: 'promptShopSize', cueKey: 'promptShopSizeCue', targetKeys: ['promptShopSizeTarget1', 'promptShopSizeTarget2'], targets: ['Do you have this in a smaller size?', 'Can I try this on?'] },
    { key: 'shop_payment', labelKey: 'promptShopPayment', cueKey: 'promptShopPaymentCue', targetKeys: ['promptShopPaymentTarget1', 'promptShopPaymentTarget2'], targets: ['Can I pay by card?', 'Could I have a bag, please?'] },
  ],
  introduce: [
    { key: 'introduce_classic', labelKey: 'promptIntroduceClassic', cueKey: 'promptIntroduceClassicCue', targetKeys: ['promptIntroduceClassicTarget1', 'promptIntroduceClassicTarget2'], targets: ['Hello, my name is Sam.', 'Nice to meet you.'] },
    { key: 'introduce_origin', labelKey: 'promptIntroduceOrigin', cueKey: 'promptIntroduceOriginCue', targetKeys: ['promptIntroduceOriginTarget1', 'promptIntroduceOriginTarget2'], targets: ['Where are you from?', 'I am from India.'] },
    { key: 'introduce_work', labelKey: 'promptIntroduceWork', cueKey: 'promptIntroduceWorkCue', targetKeys: ['promptIntroduceWorkTarget1', 'promptIntroduceWorkTarget2'], targets: ['What do you do?', 'I am a student.'] },
  ],
  directions: [
    { key: 'directions_classic', labelKey: 'promptDirectionsClassic', cueKey: 'promptDirectionsClassicCue', targetKeys: ['promptDirectionsClassicTarget1', 'promptDirectionsClassicTarget2'], targets: ['Excuse me, where is the station?', 'How do I get there?'] },
    { key: 'directions_bus', labelKey: 'promptDirectionsBus', cueKey: 'promptDirectionsBusCue', targetKeys: ['promptDirectionsBusTarget1', 'promptDirectionsBusTarget2'], targets: ['Where is the bus stop?', 'Is it far from here?'] },
    { key: 'directions_landmark', labelKey: 'promptDirectionsLandmark', cueKey: 'promptDirectionsLandmarkCue', targetKeys: ['promptDirectionsLandmarkTarget1', 'promptDirectionsLandmarkTarget2'], targets: ['How can I get to the market?', 'Should I turn left or right?'] },
  ],
  custom: [
    { key: 'custom_help', labelKey: 'promptCustomHelp', cueKey: 'promptCustomHelpCue', targetKeys: ['promptCustomHelpTarget1', 'promptCustomHelpTarget2'], targets: ['Could you help me, please?', 'Thank you for your help.'] },
    { key: 'custom_clarify', labelKey: 'promptCustomClarify', cueKey: 'promptCustomClarifyCue', targetKeys: ['promptCustomClarifyTarget1', 'promptCustomClarifyTarget2'], targets: ['Could you explain that, please?', 'Could you say that again?'] },
  ],
};

export const defaultPromptKey: Record<ScenarioId, PromptKey> = {
  cafe: 'cafe_classic',
  shop: 'shop_classic',
  introduce: 'introduce_classic',
  directions: 'directions_classic',
  custom: 'custom_help',
};

export function findPromptOption(promptKey: PromptKey): PromptOption {
  for (const options of Object.values(scenarioPromptOptions)) {
    const option = options.find((item) => item.key === promptKey);
    if (option) return option;
  }
  return scenarioPromptOptions.cafe[0]!;
}

export const scenarioTargets: Record<ScenarioId, readonly [string, string]> = {
  cafe: scenarioPromptOptions.cafe[0]!.targets,
  shop: scenarioPromptOptions.shop[0]!.targets,
  introduce: scenarioPromptOptions.introduce[0]!.targets,
  directions: scenarioPromptOptions.directions[0]!.targets,
  custom: scenarioPromptOptions.custom[0]!.targets,
};

export function isScenarioInputValid(scenario: ScenarioId, customText: string): boolean {
  if (scenario !== 'custom') return true;
  const text = customText.trim();
  const length = Array.from(text).length;
  const hasControlCharacter = Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || (codePoint >= 127 && codePoint <= 159));
  });
  return length > 0 && length <= 200 && !hasControlCharacter;
}

export function createSessionOptions(
  scenario: ScenarioId,
  promptKey: PromptKey,
  customText: string,
  uiLanguage: UiLanguage,
  voiceKey: VoiceKey,
): SessionOptions {
  if (!isScenarioInputValid(scenario, customText)) {
    throw new Error('Invalid custom scenario.');
  }
  if (!tutorVoiceChoices.some((choice) => choice.key === voiceKey)) {
    throw new Error('Unsupported tutor voice.');
  }
  if (!scenarioPromptOptions[scenario].some((option) => option.key === promptKey)) {
    throw new Error('Unsupported practice prompt.');
  }
  return {
    scenario,
    prompt_key: promptKey,
    ...(scenario === 'custom' ? { custom_scenario: customText.trim() } : {}),
    ui_language: uiLanguage,
    voice_key: voiceKey,
  };
}
