import { describe, expect, it } from 'vitest';
import {
  lessonCommandTopic,
  lessonEventTopic,
  isNewerLessonEvent,
  parseLessonEvent,
  replayCommand,
} from './lessonEvents';

function packet(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('lesson event protocol', () => {
  it('accepts a valid versioned state event', () => {
    expect(parseLessonEvent(
      packet('{"version":1,"type":"lesson_state","phase":"repeat_after_me","outcome":"prompt","attempt":1,"failed_attempts":0}'),
      lessonEventTopic,
    )).toEqual({
      version: 1,
      type: 'lesson_state',
      phase: 'repeat_after_me',
      outcome: 'prompt',
      attempt: 1,
      failed_attempts: 0,
    });
  });

  it('rejects unknown versions, fields, topics, and malformed packets', () => {
    expect(parseLessonEvent(packet('{"version":2,"type":"lesson_state","phase":"repeat_after_me","outcome":"prompt","attempt":1,"failed_attempts":0}'), lessonEventTopic)).toBeNull();
    expect(parseLessonEvent(packet('{"version":1,"type":"lesson_state","phase":"repeat_after_me","outcome":"prompt","attempt":1,"failed_attempts":0,"text":"unsafe"}'), lessonEventTopic)).toBeNull();
    expect(parseLessonEvent(packet('{"version":1,"type":"lesson_state","phase":"repeat_after_me","outcome":"prompt","attempt":1}'), lessonEventTopic)).toBeNull();
    expect(parseLessonEvent(packet('{'), lessonEventTopic)).toBeNull();
    expect(parseLessonEvent(new Uint8Array(513), lessonEventTopic)).toBeNull();
  });

  it('serializes only the documented replay command', () => {
    expect(new TextDecoder().decode(replayCommand())).toBe(
      '{"version":1,"type":"lesson_command","action":"replay"}',
    );
    expect(lessonCommandTopic).toBe('fluenz.lesson.command.v1');
  });

  it('accepts newer attempts and lesson steps but ignores duplicate or stale events', () => {
    const first = {
      version: 1 as const,
      type: 'lesson_state' as const,
      phase: 'repeat_after_me' as const,
      outcome: 'retry' as const,
      attempt: 2,
      failed_attempts: 1,
    };
    const advanced = {
      ...first,
      phase: 'name_the_object' as const,
      outcome: 'accepted' as const,
      attempt: 1,
      failed_attempts: 0,
    };
    expect(isNewerLessonEvent(null, first)).toBe(true);
    expect(isNewerLessonEvent(first, { ...first, attempt: 3, failed_attempts: 2 })).toBe(true);
    expect(isNewerLessonEvent(first, first)).toBe(false);
    expect(isNewerLessonEvent(advanced, first)).toBe(false);
  });

  it('allows the accepted final target after an explicit skip', () => {
    const skipped = {
      version: 1 as const,
      type: 'lesson_state' as const,
      phase: 'skipped' as const,
      outcome: 'skipped' as const,
      attempt: 1,
      failed_attempts: 0,
    };
    expect(isNewerLessonEvent(skipped, { ...skipped, outcome: 'accepted' })).toBe(true);
    expect(isNewerLessonEvent(skipped, { ...skipped, phase: 'completed' })).toBe(false);
  });
});
