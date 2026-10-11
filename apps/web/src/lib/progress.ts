import {
  scenarioPromptOptions,
  type PromptKey,
  type ScenarioId,
} from './sessionOptions';

export type DifficultSentence = {
  sentence: string;
  attempts: number;
};

export type VocabularyPracticeTerm = {
  term: string;
  definition: string;
  hindiMeaning: string | null;
  example: string | null;
};

export type PracticeSession = {
  sessionId: string;
  scenario: ScenarioId;
  promptKey: PromptKey;
  completedAt: string;
  localDay: string;
  failedAttempts: number;
  hesitationCount: number;
  difficultSentences: DifficultSentence[];
  vocabularyTerms: VocabularyPracticeTerm[];
};

export type Progress = {
  xp: number;
  streak: number;
  lessonsCompleted: number;
  lastActive: string | null;
  sessions: PracticeSession[];
};

export const emptyProgress: Progress = {
  xp: 0,
  streak: 0,
  lessonsCompleted: 0,
  lastActive: null,
  sessions: [],
};

const storageKey = 'fluenz-progress-v1';
const scenarios: readonly ScenarioId[] = ['cafe', 'shop', 'introduce', 'directions', 'custom'];

function parseVocabularyTerm(value: unknown): VocabularyPracticeTerm | null {
  if (typeof value === 'string') {
    if (!value.trim() || value.length > 40) return null;
    return { term: value, definition: '', hindiMeaning: null, example: null };
  }
  if (typeof value !== 'object' || value === null) return null;
  if (
    !('term' in value) ||
    typeof value.term !== 'string' ||
    !value.term.trim() ||
    value.term.length > 40 ||
    !('definition' in value) ||
    typeof value.definition !== 'string' ||
    value.definition.length > 180 ||
    !('hindiMeaning' in value) ||
    (value.hindiMeaning !== null && (typeof value.hindiMeaning !== 'string' || value.hindiMeaning.length > 100)) ||
    !('example' in value) ||
    (value.example !== null && (typeof value.example !== 'string' || value.example.length > 180))
  ) return null;
  return {
    term: value.term,
    definition: value.definition,
    hindiMeaning: value.hindiMeaning,
    example: value.example,
  };
}

export function isPracticeSession(value: unknown): value is PracticeSession {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !('sessionId' in value) ||
    typeof value.sessionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.sessionId) ||
    !('scenario' in value) ||
    typeof value.scenario !== 'string' ||
    !scenarios.includes(value.scenario as ScenarioId) ||
    !('promptKey' in value) ||
    typeof value.promptKey !== 'string' ||
    !scenarioPromptOptions[value.scenario as ScenarioId].some((option) => option.key === value.promptKey) ||
    !('completedAt' in value) ||
    typeof value.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    !('localDay' in value) ||
    typeof value.localDay !== 'string' ||
    dayNumber(value.localDay) === null ||
    !('failedAttempts' in value) ||
    typeof value.failedAttempts !== 'number' ||
    !Number.isInteger(value.failedAttempts) ||
    value.failedAttempts < 0 ||
    !('hesitationCount' in value) ||
    typeof value.hesitationCount !== 'number' ||
    !Number.isInteger(value.hesitationCount) ||
    value.hesitationCount < 0 ||
    !('difficultSentences' in value) ||
    !Array.isArray(value.difficultSentences) ||
    value.difficultSentences.length > 10 ||
    !value.difficultSentences.every((item) =>
      typeof item === 'object' &&
      item !== null &&
      'sentence' in item &&
      typeof item.sentence === 'string' &&
      item.sentence.length > 0 &&
      item.sentence.length <= 200 &&
      'attempts' in item &&
      typeof item.attempts === 'number' &&
      Number.isInteger(item.attempts) &&
      item.attempts > 0,
    ) ||
    !('vocabularyTerms' in value) ||
    !Array.isArray(value.vocabularyTerms) ||
    value.vocabularyTerms.length > 30 ||
    !value.vocabularyTerms.every((term) => parseVocabularyTerm(term) !== null)
  ) return false;
  return true;
}

export function normalizePracticeSession(session: PracticeSession): PracticeSession {
  return {
    ...session,
    vocabularyTerms: session.vocabularyTerms
      .map((term) => parseVocabularyTerm(term))
      .filter((term): term is VocabularyPracticeTerm => term !== null),
  };
}

function readableStorage(
  storage?: Pick<Storage, 'getItem'>,
): Pick<Storage, 'getItem'> | null {
  try {
    return storage ?? globalThis.localStorage;
  } catch {
    return null;
  }
}

function writableStorage(
  storage?: Pick<Storage, 'setItem'>,
): Pick<Storage, 'setItem'> | null {
  try {
    return storage ?? globalThis.localStorage;
  } catch {
    return null;
  }
}

function dayNumber(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return Math.floor(timestamp / 86_400_000);
}

function keyForUser(userId?: string): string {
  return userId ? `${storageKey}:user:${userId}` : `${storageKey}:guest`;
}

export function readProgress(storage?: Pick<Storage, 'getItem'>, userId?: string): Progress | null {
  let saved: string | null;
  try {
    const resolved = readableStorage(storage);
    if (!resolved) return null;
    saved = resolved.getItem(keyForUser(userId));
  } catch {
    return null;
  }
  if (!saved) return null;

  try {
    const value: unknown = JSON.parse(saved);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('xp' in value) ||
      !('streak' in value) ||
      !('lessonsCompleted' in value) ||
      !('lastActive' in value) ||
      typeof value.xp !== 'number' ||
      !Number.isInteger(value.xp) ||
      value.xp < 0 ||
      typeof value.streak !== 'number' ||
      !Number.isInteger(value.streak) ||
      value.streak < 0 ||
      typeof value.lessonsCompleted !== 'number' ||
      !Number.isInteger(value.lessonsCompleted) ||
      value.lessonsCompleted < 0 ||
      (value.lastActive !== null &&
        (typeof value.lastActive !== 'string' || dayNumber(value.lastActive) === null)) ||
      ('sessions' in value &&
        (!Array.isArray(value.sessions) ||
          value.sessions.length > 250 ||
          !value.sessions.every(isPracticeSession)))
    ) {
      return null;
    }
    return {
      xp: value.xp,
      streak: value.streak,
      lessonsCompleted: value.lessonsCompleted,
      lastActive: value.lastActive,
      sessions: 'sessions' in value && Array.isArray(value.sessions)
        ? value.sessions.filter(isPracticeSession).map(normalizePracticeSession)
        : [],
    };
  } catch {
    return null;
  }
}

export function hasInvalidProgress(storage?: Pick<Storage, 'getItem'>, userId?: string): boolean {
  try {
    const resolved = readableStorage(storage);
    return resolved !== null &&
      resolved.getItem(keyForUser(userId)) !== null &&
      readProgress(resolved, userId) === null;
  } catch {
    return false;
  }
}

export function writeProgress(
  progress: Progress,
  storage?: Pick<Storage, 'setItem'>,
  userId?: string,
): void {
  const resolved = writableStorage(storage);
  if (!resolved) throw new Error('Local progress storage is unavailable.');
  resolved.setItem(keyForUser(userId), JSON.stringify(progress));
}

export function completeLesson(
  progress: Progress,
  date: string,
  completedSession?: PracticeSession,
): Progress {
  if (completedSession && progress.sessions.some((item) => item.sessionId === completedSession.sessionId)) {
    return progress;
  }
  const todayNumber = dayNumber(date);
  if (todayNumber === null) throw new Error('Completion date must be a valid local calendar date.');
  const previousNumber = dayNumber(progress.lastActive);
  const streak = progress.lastActive === date
    ? progress.streak
    : previousNumber !== null && todayNumber - previousNumber === 1
      ? progress.streak + 1
      : 1;

  return {
    xp: progress.xp + 10,
    streak,
    lessonsCompleted: progress.lessonsCompleted + 1,
    lastActive: date,
    sessions: completedSession
      ? [...progress.sessions, completedSession].slice(-250)
      : progress.sessions,
  };
}

export function currentStreak(progress: Progress, date: string): number {
  const todayNumber = dayNumber(date);
  const lastNumber = dayNumber(progress.lastActive);
  if (todayNumber === null || lastNumber === null || todayNumber - lastNumber < 0 || todayNumber - lastNumber > 1) return 0;
  return progress.streak;
}

export function mergeProgress(local: Progress, cloud: Progress): Progress {
  const sessionsById = new Map<string, PracticeSession>();
  for (const session of [...cloud.sessions, ...local.sessions]) {
    if (!sessionsById.has(session.sessionId)) sessionsById.set(session.sessionId, session);
  }
  const sessions = [...sessionsById.values()].sort((left, right) =>
    left.completedAt.localeCompare(right.completedAt),
  ).slice(-250);
  const useLocalStreak = (local.lastActive ?? '') > (cloud.lastActive ?? '');
  const sameDay = local.lastActive !== null && local.lastActive === cloud.lastActive;
  return {
    xp: Math.max(local.xp, cloud.xp),
    streak: sameDay
      ? Math.max(local.streak, cloud.streak)
      : useLocalStreak ? local.streak : cloud.streak,
    lessonsCompleted: Math.max(local.lessonsCompleted, cloud.lessonsCompleted, sessions.length),
    lastActive: useLocalStreak ? local.lastActive : cloud.lastActive,
    sessions,
  };
}

export function createPracticeSessionId(cryptoProvider: Crypto = globalThis.crypto): string {
  if (typeof cryptoProvider.randomUUID === 'function') return cryptoProvider.randomUUID();
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
