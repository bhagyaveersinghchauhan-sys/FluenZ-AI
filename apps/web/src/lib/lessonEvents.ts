export const lessonEventTopic = 'fluenz.lesson.v1';
export const lessonCommandTopic = 'fluenz.lesson.command.v1';

export type LessonPhase =
  | 'repeat_after_me'
  | 'name_the_object'
  | 'completed'
  | 'skipped';
export type LessonOutcome =
  | 'prompt'
  | 'retry'
  | 'unclear'
  | 'accepted'
  | 'completed'
  | 'skipped';
export type LessonEvent = {
  version: 1;
  type: 'lesson_state';
  phase: LessonPhase;
  outcome: LessonOutcome;
  attempt: number;
  failed_attempts: number;
};

const phaseOrder: Record<LessonPhase, number> = {
  repeat_after_me: 0,
  name_the_object: 1,
  skipped: 2,
  completed: 2,
};
const outcomeOrder: Record<LessonOutcome, number> = {
  prompt: 0,
  unclear: 1,
  retry: 2,
  skipped: 3,
  accepted: 4,
  completed: 4,
};

export function isNewerLessonEvent(current: LessonEvent | null, next: LessonEvent): boolean {
  if (!current) return true;
  if (
    (current.phase === 'completed' && next.phase !== 'completed') ||
    (current.phase === 'skipped' && next.phase !== 'skipped')
  ) return false;
  if (
    (next.phase === 'completed' && current.phase === 'skipped') ||
    (next.phase === 'skipped' && current.phase === 'completed')
  ) return false;
  if (phaseOrder[next.phase] !== phaseOrder[current.phase]) {
    return phaseOrder[next.phase] > phaseOrder[current.phase];
  }
  if (next.phase !== current.phase) {
    return next.phase === 'completed' || current.phase !== 'completed';
  }
  if (next.attempt !== current.attempt) return next.attempt > current.attempt;
  return outcomeOrder[next.outcome] > outcomeOrder[current.outcome];
}

const phases: readonly LessonPhase[] = [
  'repeat_after_me',
  'name_the_object',
  'completed',
  'skipped',
];
const outcomes: readonly LessonOutcome[] = [
  'prompt',
  'retry',
  'unclear',
  'accepted',
  'completed',
  'skipped',
];

export function parseLessonEvent(
  payload: Uint8Array,
  topic: string | undefined,
): LessonEvent | null {
  if (topic !== lessonEventTopic || payload.byteLength > 512) return null;

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('type' in value) ||
      value.type !== 'lesson_state' ||
      !('phase' in value) ||
      typeof value.phase !== 'string' ||
      !phases.includes(value.phase as LessonPhase) ||
      !('outcome' in value) ||
      typeof value.outcome !== 'string' ||
      !outcomes.includes(value.outcome as LessonOutcome) ||
      !('attempt' in value) ||
      typeof value.attempt !== 'number' ||
      !Number.isInteger(value.attempt) ||
      value.attempt < 1 ||
      value.attempt > 99 ||
      !('failed_attempts' in value) ||
      typeof value.failed_attempts !== 'number' ||
      !Number.isInteger(value.failed_attempts) ||
      value.failed_attempts < 0 ||
      value.failed_attempts > 99 ||
      Object.keys(value).length !== 6
    ) {
      return null;
    }
    return {
      version: 1,
      type: 'lesson_state',
      phase: value.phase as LessonPhase,
      outcome: value.outcome as LessonOutcome,
      attempt: value.attempt,
      failed_attempts: value.failed_attempts,
    };
  } catch {
    return null;
  }
}

export function replayCommand(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({ version: 1, type: 'lesson_command', action: 'replay' }),
  );
}
