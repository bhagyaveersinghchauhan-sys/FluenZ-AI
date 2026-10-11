export const coachEventTopic = 'fluenz.coach.v1';

export type VocabularyCard = {
  term: string;
  definition: string;
  hindi_meaning: string | null;
  example: string | null;
};

export type VocabularyEvent = {
  version: 1;
  type: 'vocabulary';
  sequence: number;
  cards: VocabularyCard[];
};

export type FluencyEvent = {
  version: 1;
  type: 'fluency';
  sequence: number;
  status: 'idle' | 'thinking' | 'hint';
  hesitation_count: number;
  hint: string | null;
};

export type CoachEvent = VocabularyEvent | FluencyEvent;

function isBoundedText(value: unknown, maxLength: number): value is string;
function isBoundedText(value: unknown, maxLength: number, allowNull: true): value is string | null;
function isBoundedText(
  value: unknown,
  maxLength: number,
  allowNull = false,
): value is string | null {
  return (allowNull && value === null) ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maxLength &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint < 32 || (codePoint >= 127 && codePoint <= 159));
      }));
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function parseCard(value: unknown): VocabularyCard | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('term' in value) ||
    !isBoundedText(value.term, 40) ||
    !('definition' in value) ||
    !isBoundedText(value.definition, 180) ||
    !('hindi_meaning' in value) ||
    !isBoundedText(value.hindi_meaning, 100, true) ||
    !('example' in value) ||
    !isBoundedText(value.example, 180, true) ||
    !hasExactKeys(value, ['term', 'definition', 'hindi_meaning', 'example'])
  ) return null;
  const hindiMeaning = value.hindi_meaning;
  const example = value.example;
  return {
    term: value.term,
    definition: value.definition,
    hindi_meaning: hindiMeaning,
    example,
  };
}

export function parseCoachEvent(
  payload: Uint8Array,
  topic: string | undefined,
): CoachEvent | null {
  if (topic !== coachEventTopic || payload.byteLength > 4096) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('type' in value) ||
      !('sequence' in value) ||
      typeof value.sequence !== 'number' ||
      !Number.isInteger(value.sequence) ||
      value.sequence < 1 ||
      value.sequence > 2_147_483_647
    ) return null;

    if (
      value.type === 'vocabulary' &&
      'cards' in value &&
      Array.isArray(value.cards) &&
      value.cards.length >= 1 &&
      value.cards.length <= 3 &&
      hasExactKeys(value, ['version', 'type', 'sequence', 'cards'])
    ) {
      const cards: VocabularyCard[] = [];
      for (const item of value.cards) {
        const card = parseCard(item);
        if (!card) return null;
        cards.push(card);
      }
      return {
        version: 1,
        type: 'vocabulary',
        sequence: value.sequence,
        cards,
      };
    }
    if (
      value.type === 'fluency' &&
      'status' in value &&
      (value.status === 'idle' || value.status === 'thinking' || value.status === 'hint') &&
      'hesitation_count' in value &&
      typeof value.hesitation_count === 'number' &&
      Number.isInteger(value.hesitation_count) &&
      value.hesitation_count >= 0 &&
      value.hesitation_count <= 2_147_483_647 &&
      'hint' in value &&
      isBoundedText(value.hint, 240, true) &&
      hasExactKeys(value, ['version', 'type', 'sequence', 'status', 'hesitation_count', 'hint']) &&
      (value.status !== 'hint' || typeof value.hint === 'string') &&
      (value.status === 'hint' || value.hint === null)
    ) {
      return {
        version: 1,
        type: 'fluency',
        sequence: value.sequence,
        status: value.status,
        hesitation_count: value.hesitation_count,
        hint: value.hint,
      };
    }
    return null;
  } catch {
    return null;
  }
}
