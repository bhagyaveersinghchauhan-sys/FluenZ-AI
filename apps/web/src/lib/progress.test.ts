import { describe, expect, it } from 'vitest';
import {
  completeLesson,
  currentStreak,
  emptyProgress,
  hasInvalidProgress,
  mergeProgress,
  readProgress,
  writeProgress,
} from './progress';

describe('progress tracking', () => {
  it('starts and increments a daily streak without duplicating today', () => {
    const first = completeLesson(emptyProgress, '2026-10-10');
    expect(first).toEqual({
      xp: 10,
      streak: 1,
      lessonsCompleted: 1,
      lastActive: '2026-10-10',
      sessions: [],
    });
    expect(completeLesson(first, '2026-10-10').streak).toBe(1);
    expect(completeLesson(first, '2026-10-11').streak).toBe(2);
    expect(completeLesson(first, '2026-10-13').streak).toBe(1);
  });

  it('shows the streak only on the completion day or the following day', () => {
    const progress = completeLesson(emptyProgress, '2026-10-10');
    expect(currentStreak(progress, '2026-10-10')).toBe(1);
    expect(currentStreak(progress, '2026-10-11')).toBe(1);
    expect(currentStreak(progress, '2026-10-12')).toBe(0);
    expect(currentStreak(progress, '2026-10-09')).toBe(0);
  });

  it('round-trips valid local progress and rejects corrupt saved data', () => {
    const storage = window.localStorage;
    writeProgress(emptyProgress, storage);
    expect(readProgress(storage)).toEqual(emptyProgress);
    storage.setItem('fluenz-progress-v1:guest', '{"xp":-1}');
    expect(readProgress(storage)).toBeNull();
    expect(hasInvalidProgress(storage)).toBe(true);
  });

  it('preserves older local sessions while normalizing vocabulary terms without saved definitions', () => {
    const storage = window.localStorage;
    storage.setItem('fluenz-progress-v1:guest', JSON.stringify({
      ...emptyProgress,
      sessions: [{
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        scenario: 'cafe',
        promptKey: 'cafe_tea',
        completedAt: '2026-10-10T09:00:00.000Z',
        localDay: '2026-10-10',
        failedAttempts: 0,
        hesitationCount: 0,
        difficultSentences: [],
        vocabularyTerms: ['tea'],
      }],
    }));

    expect(readProgress(storage)?.sessions[0]?.vocabularyTerms).toEqual([{
      term: 'tea',
      definition: '',
      hindiMeaning: null,
      example: null,
    }]);
  });

  it('rejects malformed completion dates without displaying a false streak', () => {
    const storage = window.localStorage;
    storage.setItem('fluenz-progress-v1:guest', JSON.stringify({
      xp: 10,
      streak: 5,
      lessonsCompleted: 1,
      lastActive: '2026-02-30',
    }));
    expect(readProgress(storage)).toBeNull();
    expect(currentStreak({ ...emptyProgress, streak: 5, lastActive: 'not-a-date' }, '2026-10-10')).toBe(0);
    expect(() => completeLesson(emptyProgress, '2026-02-30')).toThrow();
  });

  it('does not claim progress was saved when local storage writes fail', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('storage full'); },
    };
    expect(readProgress(storage)).toBeNull();
    expect(hasInvalidProgress(storage)).toBe(false);
    expect(() => writeProgress(emptyProgress, storage)).toThrow('storage full');
  });

  it('does not report malformed progress when storage itself cannot be read', () => {
    const storage = {
      getItem: () => { throw new Error('storage blocked'); },
    };
    expect(readProgress(storage)).toBeNull();
    expect(hasInvalidProgress(storage)).toBe(false);
  });

  it('keeps guest and signed-in progress caches isolated', () => {
    const storage = window.localStorage;
    writeProgress({ ...emptyProgress, xp: 10 }, storage);
    writeProgress({ ...emptyProgress, xp: 30 }, storage, 'user-a');
    expect(readProgress(storage)?.xp).toBe(10);
    expect(readProgress(storage, 'user-a')?.xp).toBe(30);
    expect(readProgress(storage, 'user-b')).toBeNull();
  });

  it('counts a completed session once and a local calendar day once toward a streak', () => {
    const session = {
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      scenario: 'cafe' as const,
      promptKey: 'cafe_tea' as const,
      completedAt: '2026-10-10T09:00:00.000Z',
      localDay: '2026-10-10',
      failedAttempts: 1,
      hesitationCount: 2,
      difficultSentences: [{ sentence: 'I would like tea.', attempts: 1 }],
      vocabularyTerms: [{
        term: 'tea',
        definition: 'A hot drink.',
        hindiMeaning: 'चाय',
        example: 'I would like tea.',
      }],
    };
    const first = completeLesson(emptyProgress, '2026-10-10', session);
    const duplicate = completeLesson(first, '2026-10-10', session);
    const anotherSameDay = completeLesson(first, '2026-10-10', {
      ...session,
      sessionId: '123e4567-e89b-42d3-a456-426614174001',
    });

    expect(duplicate).toBe(first);
    expect(anotherSameDay.lessonsCompleted).toBe(2);
    expect(anotherSameDay.streak).toBe(1);
    expect(anotherSameDay.sessions).toHaveLength(2);
  });

  it('merges local and cloud sessions deterministically without duplicate IDs', () => {
    const session = {
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      scenario: 'cafe' as const,
      promptKey: 'cafe_tea' as const,
      completedAt: '2026-10-10T09:00:00.000Z',
      localDay: '2026-10-10',
      failedAttempts: 1,
      hesitationCount: 2,
      difficultSentences: [{ sentence: 'I would like tea.', attempts: 1 }],
      vocabularyTerms: [{
        term: 'tea',
        definition: 'A hot drink.',
        hindiMeaning: 'चाय',
        example: 'I would like tea.',
      }],
    };
    const local = { ...emptyProgress, lessonsCompleted: 1, sessions: [session] };
    const cloud = { ...emptyProgress, lessonsCompleted: 1, sessions: [session] };
    const merged = mergeProgress(local, cloud);

    expect(merged.sessions).toEqual([session]);
    expect(merged.lessonsCompleted).toBe(1);
  });
});
