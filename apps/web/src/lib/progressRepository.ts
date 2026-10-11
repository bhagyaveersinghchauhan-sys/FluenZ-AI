import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emptyProgress,
  isPracticeSession,
  normalizePracticeSession,
  readProgress,
  writeProgress,
  type PracticeSession,
  type Progress,
} from './progress';
import type { UiLanguage } from './i18n';

type ProgressRow = {
  xp: number;
  streak: number;
  lessons_completed: number;
  last_active: string | null;
};

export type CloudSnapshot = {
  progress: Progress;
  displayName: string | null;
};

export type ProgressRepository = {
  readLocal: (userId?: string) => Progress | null;
  writeLocal: (progress: Progress, userId?: string) => void;
  readCloud: (userId: string) => Promise<CloudSnapshot>;
  writeProfile: (userId: string, displayName: string, language: UiLanguage) => Promise<void>;
  writeCompletedSession: (userId: string, session: PracticeSession) => Promise<void>;
  importGuestProgress: (userId: string, guest: Progress) => Promise<void>;
};

function mapPracticeSession(row: Record<string, unknown>): PracticeSession {
  const parsed = {
    sessionId: row.session_id,
    scenario: row.scenario,
    promptKey: row.prompt_key,
    completedAt: row.completed_at,
    localDay: row.local_day,
    failedAttempts: row.failed_attempts,
    hesitationCount: row.hesitation_count,
    difficultSentences: row.difficult_sentences,
    vocabularyTerms: row.vocabulary_terms,
  };
  if (!isPracticeSession(parsed)) throw new Error('Cloud returned an invalid practice record.');
  return normalizePracticeSession(parsed);
}

async function recordSession(
  supabase: SupabaseClient,
  session: PracticeSession,
): Promise<void> {
  const { error } = await supabase.rpc('record_practice_completion', {
    p_session_id: session.sessionId,
    p_scenario: session.scenario,
    p_prompt_key: session.promptKey,
    p_local_day: session.localDay,
    p_completed_at: session.completedAt,
    p_failed_attempts: session.failedAttempts,
    p_hesitation_count: session.hesitationCount,
    p_difficult_sentences: session.difficultSentences,
    p_vocabulary_terms: session.vocabularyTerms,
  });
  if (error) throw new Error('Could not synchronize the completed practice.');
}

async function requireAuthenticatedOwner(
  supabase: SupabaseClient,
  expectedUserId: string,
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== expectedUserId) {
    throw new Error('The authenticated account does not match the requested owner.');
  }
}

export function createProgressRepository(
  supabase: SupabaseClient | null,
  storage?: Storage,
): ProgressRepository {
  return {
    readLocal: (userId) => readProgress(storage, userId),
    writeLocal: (progress, userId) => writeProgress(progress, storage, userId),

    async readCloud(userId) {
      if (!supabase) return { progress: emptyProgress, displayName: null };
      await requireAuthenticatedOwner(supabase, userId);
      const [progressResult, sessionsResult, profileResult] = await Promise.all([
        supabase
          .from('lesson_progress')
          .select('xp, streak, lessons_completed, last_active')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('practice_sessions')
          .select('session_id, scenario, prompt_key, completed_at, local_day, failed_attempts, hesitation_count, difficult_sentences, vocabulary_terms')
          .eq('user_id', userId)
          .order('completed_at', { ascending: false })
          .limit(250),
        supabase
          .from('profiles')
          .select('display_name')
          .eq('id', userId)
          .maybeSingle(),
      ]);
      if (progressResult.error || sessionsResult.error || profileResult.error) {
        throw new Error('Could not load account learning progress.');
      }

      const row: ProgressRow | null = progressResult.data;
      const sessions = (sessionsResult.data ?? []).map((item) =>
        mapPracticeSession(item as Record<string, unknown>),
      ).reverse();
      const progress: Progress = row
        ? {
            xp: row.xp,
            streak: row.streak,
            lessonsCompleted: row.lessons_completed,
            lastActive: row.last_active,
            sessions,
          }
        : { ...emptyProgress, sessions };
      const displayName = profileResult.data?.display_name;
      return {
        progress,
        displayName: typeof displayName === 'string' ? displayName : null,
      };
    },

    async writeProfile(userId, displayName, language) {
      if (!supabase) throw new Error('Account synchronization is not configured.');
      await requireAuthenticatedOwner(supabase, userId);
      const { error } = await supabase.from('profiles').upsert({
        id: userId,
        display_name: displayName.trim().slice(0, 80) || 'Learner',
        preferred_language: language,
      });
      if (error) throw new Error('Could not save the account profile.');
    },

    async writeCompletedSession(userId, session) {
      if (!supabase) throw new Error('Account synchronization is not configured.');
      await requireAuthenticatedOwner(supabase, userId);
      await recordSession(supabase, session);
    },

    async importGuestProgress(userId, guest) {
      if (!supabase) throw new Error('Account synchronization is not configured.');
      await requireAuthenticatedOwner(supabase, userId);
      for (const session of guest.sessions) await recordSession(supabase, session);
      const { error } = await supabase.rpc('merge_legacy_guest_progress', {
        p_xp: guest.xp,
        p_lessons_completed: guest.lessonsCompleted,
        p_streak: guest.streak,
        p_last_active: guest.lastActive,
      });
      if (error) throw new Error('Could not merge guest progress.');
    },
  };
}
