import { translate, type UiLanguage } from '../lib/i18n';
import {
  currentStreak,
  type Progress,
} from '../lib/progress';
import {
  findPromptOption,
  type PromptKey,
  type ScenarioId,
} from '../lib/sessionOptions';

type LearningDashboardProps = {
  uiLanguage: UiLanguage;
  progress: Progress;
  today: string;
  displayName: string;
  syncUnavailable: boolean;
  onPractice: (scenario: ScenarioId, promptKey: PromptKey) => void;
  onSignOut: () => void;
};

const scenarioTitleKeys: Record<ScenarioId, string> = {
  cafe: 'scenarioCafe',
  shop: 'scenarioShop',
  introduce: 'scenarioIntroduce',
  directions: 'scenarioDirections',
  custom: 'scenarioCustom',
};

export default function LearningDashboard({
  uiLanguage,
  progress,
  today,
  displayName,
  syncUnavailable,
  onPractice,
  onSignOut,
}: LearningDashboardProps) {
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(uiLanguage, key, values);
  const recentSessions = [...progress.sessions].reverse().slice(0, 5);
  const hesitationTotal = recentSessions.reduce((sum, session) => sum + session.hesitationCount, 0);
  const wordsByTerm = new Map<string, {
    term: string;
    definition: string;
    hindiMeaning: string | null;
  }>();
  for (const session of recentSessions) {
    for (const word of session.vocabularyTerms) {
      const key = word.term.toLocaleLowerCase();
      if (!wordsByTerm.has(key)) {
        wordsByTerm.set(key, {
          term: word.term,
          definition: word.definition,
          hindiMeaning: word.hindiMeaning,
        });
      }
    }
  }
  const words = [...wordsByTerm.values()].slice(0, 8);
  const sentenceReviews = new Map<string, {
    scenario: ScenarioId;
    promptKey: PromptKey;
    sentence: string;
    attempts: number;
  }>();
  for (const session of recentSessions) {
    for (const item of session.difficultSentences) {
      const key = `${session.scenario}:${session.promptKey}:${item.sentence.toLocaleLowerCase()}`;
      const existing = sentenceReviews.get(key);
      sentenceReviews.set(key, {
        scenario: session.scenario,
        promptKey: session.promptKey,
        sentence: item.sentence,
        attempts: (existing?.attempts ?? 0) + item.attempts,
      });
    }
  }
  const reviewItems = [...sentenceReviews.values()].slice(0, 6);
  const dateFormatter = new Intl.DateTimeFormat(uiLanguage === 'hi' ? 'hi-IN' : 'en-US', {
    dateStyle: 'medium',
  });

  return (
    <section className="dashboard" aria-labelledby="dashboard-heading">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{t('dashboardEyebrow')}</p>
          <h1 id="dashboard-heading">{t('dashboardWelcome', { name: displayName })}</h1>
          <p>{t('dashboardIntro')}</p>
        </div>
        <button type="button" className="account-button" onClick={onSignOut}>{t('signOut')}</button>
      </div>

      <div className="dashboard-stats" aria-label={t('progressLabel')}>
        <article className="dashboard-stat">
          <span>{t('dashboardSessions')}</span>
          <strong>{progress.lessonsCompleted}</strong>
        </article>
        <article className="dashboard-stat">
          <span>{t('dashboardStreak')}</span>
          <strong>{currentStreak(progress, today)}</strong>
        </article>
        <article className="dashboard-stat dashboard-stat-note">
          <span>{t('dashboardPauses')}</span>
          <strong>{hesitationTotal}</strong>
          <small>{t('dashboardNoTiming')}</small>
        </article>
      </div>

      <button
        type="button"
        className="primary-button dashboard-continue"
        onClick={() => onPractice('cafe', 'cafe_classic')}
      >
        {t('dashboardContinue')}
      </button>

      {syncUnavailable && <p className="message notice-message" role="status">{t('dashboardSyncUnavailable')}</p>}

      <div className="dashboard-sections">
        <section className="dashboard-card" aria-labelledby="dashboard-words-heading">
          <h2 id="dashboard-words-heading">{t('dashboardWords')}</h2>
          <p className="dashboard-help">{t('dashboardWordsHelp')}</p>
          {words.length === 0
            ? <p className="dashboard-empty">{t('dashboardWordsEmpty')}</p>
            : <ul className="dashboard-word-list">{words.map((word) => (
                <li key={word.term}>
                  <strong>{word.term}</strong>
                  {word.definition && <span>{word.definition}</span>}
                  {word.hindiMeaning && <span lang="hi">{word.hindiMeaning}</span>}
                </li>
              ))}</ul>}
        </section>

        <section className="dashboard-card" aria-labelledby="dashboard-sentences-heading">
          <h2 id="dashboard-sentences-heading">{t('dashboardSentences')}</h2>
          <p className="dashboard-help">{t('dashboardAsrNote')}</p>
          {reviewItems.length === 0
            ? <p className="dashboard-empty">{t('dashboardSentencesEmpty')}</p>
            : <ul className="dashboard-review-list">{reviewItems.map((item) => {
                const option = findPromptOption(item.promptKey);
                return (
                  <li key={`${item.scenario}-${item.promptKey}-${item.sentence}`}>
                    <div>
                      <q lang="en">{item.sentence}</q>
                      <small>{t('dashboardRetryCount', { count: item.attempts })}</small>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onPractice(item.scenario, option.key)}
                    >
                      {t('dashboardReview')}
                    </button>
                  </li>
                );
              })}</ul>}
        </section>

        <section className="dashboard-card dashboard-history" aria-labelledby="dashboard-history-heading">
          <h2 id="dashboard-history-heading">{t('dashboardRecent')}</h2>
          {recentSessions.length === 0
            ? <p className="dashboard-empty">{t('dashboardHistoryEmpty')}</p>
            : <ol className="practice-timeline">{recentSessions.map((session) => (
                <li key={session.sessionId}>
                  <span className="timeline-mark" aria-hidden="true" />
                  <div>
                    <strong>{t(scenarioTitleKeys[session.scenario])} · {t(findPromptOption(session.promptKey).labelKey)}</strong>
                    <time dateTime={session.completedAt}>{dateFormatter.format(new Date(session.completedAt))}</time>
                    <small>{t('dashboardSessionDetail', {
                      retries: session.failedAttempts,
                      pauses: session.hesitationCount,
                    })}</small>
                  </div>
                </li>
              ))}</ol>}
        </section>
      </div>
    </section>
  );
}
