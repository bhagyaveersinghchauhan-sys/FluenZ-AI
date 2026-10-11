import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createVoiceSession, VoiceSessionError, type VoiceSession } from './lib/api';
import {
  completeLesson,
  currentStreak,
  emptyProgress,
  hasInvalidProgress,
  mergeProgress,
  createPracticeSessionId,
  type PracticeSession,
  type Progress,
} from './lib/progress';
import type { CompletedLessonDetails } from './components/VoiceLesson';
import { createProgressRepository } from './lib/progressRepository';
import { getSupabaseClient, getSupabaseConfigurationIssue } from './lib/supabase';
import {
  readUiLanguage,
  translate,
  writeUiLanguage,
  type UiLanguage,
} from './lib/i18n';
import {
  createSessionOptions,
  isScenarioInputValid,
  tutorVoiceChoices,
  defaultPromptKey,
  scenarioPromptOptions,
  type PromptKey,
  type ScenarioId,
  type VoiceKey,
} from './lib/sessionOptions';
import AuthPanel from './components/AuthPanel';
import LearningDashboard from './components/LearningDashboard';

const VoiceLesson = lazy(() => import('./components/VoiceLesson'));
const supabase = getSupabaseClient();
const supabaseConfigurationIssue = getSupabaseConfigurationIssue();
const scenarios: readonly {
  id: ScenarioId;
  titleKey: string;
  descriptionKey: string;
  labelKey: string;
  icon: ScenarioId;
}[] = [
  { id: 'cafe', titleKey: 'scenarioCafe', descriptionKey: 'scenarioCafeDescription', labelKey: 'scenarioCafeLabel', icon: 'cafe' },
  { id: 'shop', titleKey: 'scenarioShop', descriptionKey: 'scenarioShopDescription', labelKey: 'scenarioShopLabel', icon: 'shop' },
  { id: 'introduce', titleKey: 'scenarioIntroduce', descriptionKey: 'scenarioIntroduceDescription', labelKey: 'scenarioIntroduceLabel', icon: 'introduce' },
  { id: 'directions', titleKey: 'scenarioDirections', descriptionKey: 'scenarioDirectionsDescription', labelKey: 'scenarioDirectionsLabel', icon: 'directions' },
  { id: 'custom', titleKey: 'scenarioCustom', descriptionKey: 'scenarioCustomDescription', labelKey: 'scenarioCustomLabel', icon: 'custom' },
];

function today(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function ScenarioIcon({ type }: { type: ScenarioId }) {
  const common = {
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  const art = {
    cafe: <><path d="M12 18h21v9a8 8 0 0 1-8 8h-5a8 8 0 0 1-8-8z" /><path d="M33 21h3a5 5 0 0 1 0 10h-4M17 10v4m8-5v5m8-4v4M16 40h18" /></>,
    shop: <><path d="M10 17h28l-3 7H13z" /><path d="M14 24v16h20V24M20 40V29h8v11M10 17l3-8h22l3 8" /></>,
    introduce: <><circle cx="19" cy="16" r="7" /><path d="M6 39a13 13 0 0 1 26 0M31 14a7 7 0 0 1 0 14m2 4a12 12 0 0 1 9 7" /></>,
    directions: <><path d="M24 42s14-13 14-25a14 14 0 0 0-28 0c0 12 14 25 14 25z" /><circle cx="24" cy="17" r="5" /><path d="m21 18 3-6 3 6-3 4z" /></>,
    custom: <><path d="M11 37 13 29 32 10a4 4 0 0 1 6 6L19 35z" /><path d="m28 14 6 6M11 40h27" /></>,
  }[type];
  return <svg {...common}>{art}</svg>;
}

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c4.4 0 7.5-3.2 7.5-7.4 0-3.2-1.7-5.6-4.2-8.1-.1 2.3-1.1 3.7-2.5 4.5C12.6 7.1 10.5 3.8 7 2 7.7 6.4 4.5 9 4.5 14.6 4.5 18.8 7.6 22 12 22Z" />
      <path d="M12 19c1.8 0 3-1.3 3-3.1 0-1.3-.7-2.3-1.8-3.3-.1 1-.5 1.6-1.1 1.9-.1-1.5-1-2.8-2.4-3.6.3 1.9-1 3-1 5 0 1.8 1.3 3.1 3.3 3.1Z" />
    </svg>
  );
}

export default function App() {
  const repository = useMemo(() => createProgressRepository(supabase), []);
  const [language, setLanguage] = useState<UiLanguage | null>(() => readUiLanguage());
  const activeLanguage = language ?? 'en';
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(activeLanguage, key, values),
    [activeLanguage],
  );
  const [progress, setProgress] = useState<Progress>(
    () => repository.readLocal() ?? emptyProgress,
  );
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioId>('cafe');
  const [scenario, setScenario] = useState<ScenarioId>('cafe');
  const [promptKey, setPromptKey] = useState<PromptKey>(defaultPromptKey.cafe);
  const [showExample, setShowExample] = useState(false);
  const [customText, setCustomText] = useState('');
  const [voiceKey, setVoiceKey] = useState<VoiceKey>('default');
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [showPracticePicker, setShowPracticePicker] = useState(true);
  const [guestProgress, setGuestProgress] = useState<Progress>(emptyProgress);
  const [progressOwnerId, setProgressOwnerId] = useState<string | null>(null);
  const [guestImportPending, setGuestImportPending] = useState(false);
  const [syncUnavailable, setSyncUnavailable] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scenarioError, setScenarioError] = useState('');
  const [notice, setNotice] = useState('');
  const authUserId = useRef<string | null>(null);
  const lessonSaved = useRef(false);
  const activeSession = useRef<{ id: string; scenario: ScenarioId; promptKey: PromptKey } | null>(null);

  useEffect(() => {
    if (supabaseConfigurationIssue) setNotice(t('supabaseConfigurationIssue'));
  }, [t]);

  useEffect(() => {
    if (!language) return;
    if (hasInvalidProgress()) setNotice(t('corruptProgress'));
  }, [language, t]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (!active) return;
      authEventReceived = true;
      const nextUser = authSession?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const identityChanged = nextUserId !== authUserId.current;
      authUserId.current = nextUserId;
      setUser(nextUser);
      if (!nextUser) {
        const guest = repository.readLocal() ?? emptyProgress;
        setProgress(guest);
        setGuestProgress(guest);
        setProgressOwnerId(null);
        setGuestImportPending(false);
        setShowPracticePicker(true);
        setDisplayName('');
        setSyncUnavailable(false);
      } else if (identityChanged) {
        setProgress(repository.readLocal(nextUser.id) ?? emptyProgress);
        setProgressOwnerId(nextUser.id);
        setGuestProgress(repository.readLocal() ?? emptyProgress);
        setGuestImportPending(false);
        setShowPracticePicker(false);
        setDisplayName(
          typeof nextUser.user_metadata.display_name === 'string'
            ? nextUser.user_metadata.display_name
            : nextUser.email?.split('@')[0] || 'Learner',
        );
        setCloudLoading(true);
      }
    });
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active || authEventReceived) return;
      if (authError) {
        setNotice(t('guestAccountUnavailable'));
        return;
      }
      authUserId.current = data.session?.user.id ?? null;
      setUser(data.session?.user ?? null);
    }).catch(() => {
      if (active) setNotice(t('guestAccountUnavailable'));
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [repository, t]);

  useEffect(() => {
    if (!user) {
      const guest = repository.readLocal() ?? emptyProgress;
      setProgress(guest);
      setProgressOwnerId(null);
      setGuestProgress(guest);
      setGuestImportPending(false);
      setShowPracticePicker(true);
      setDisplayName('');
      setSyncUnavailable(false);
      if (hasInvalidProgress(undefined)) setNotice(t('corruptProgress'));
      return;
    }

    let active = true;
    const guest = repository.readLocal() ?? emptyProgress;
    const hasGuestProgress = guest.lessonsCompleted > 0 || guest.sessions.length > 0;
    setGuestProgress(guest);
    setGuestImportPending(hasGuestProgress);
    setShowPracticePicker(false);
    const accountLocal = repository.readLocal(user.id) ?? emptyProgress;
    setProgress(accountLocal);
    setProgressOwnerId(user.id);
    setDisplayName('');
    setCloudLoading(true);
    void (async () => {
      try {
        let cloud = await repository.readCloud(user.id);
        const accountLocal = repository.readLocal(user.id) ?? emptyProgress;
        const cloudSessionIds = new Set(cloud.progress.sessions.map((item) => item.sessionId));
        const pendingSessions = accountLocal.sessions.filter((item) => !cloudSessionIds.has(item.sessionId));
        for (const pending of pendingSessions) {
          await repository.writeCompletedSession(user.id, pending);
        }
        if (pendingSessions.length > 0) cloud = await repository.readCloud(user.id);
        const merged = mergeProgress(accountLocal, cloud.progress);
        repository.writeLocal(merged, user.id);
        const metadataName = user.user_metadata.display_name;
        const name = cloud.displayName ||
          (typeof metadataName === 'string' ? metadataName : '') ||
          user.email?.split('@')[0] ||
          'Learner';
        if (!cloud.displayName) {
          await repository.writeProfile(user.id, name, activeLanguage);
        }
        if (active) {
          setProgress(merged);
          setDisplayName(name);
          setSyncUnavailable(false);
          if (!hasGuestProgress) setNotice(t('accountProgressConnected'));
        }
      } catch {
        if (active) {
          setProgress(repository.readLocal(user.id) ?? emptyProgress);
          setDisplayName(
            typeof user.user_metadata.display_name === 'string'
              ? user.user_metadata.display_name
              : user.email?.split('@')[0] || 'Learner',
          );
          setSyncUnavailable(true);
          setNotice(t('cloudUnavailable'));
        }
      } finally {
        if (active) setCloudLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activeLanguage, repository, t, user]);

  const chooseLanguage = (next: UiLanguage) => {
    setLanguage(next);
    setNotice(writeUiLanguage(next) ? '' : translate(next, 'languageNotSaved'));
  };

  const startLesson = useCallback(async () => {
    if (!isScenarioInputValid(scenario, customText)) {
      setScenarioError(scenario === 'custom'
        ? Array.from(customText.trim()).length === 0
          ? t('customEmpty')
          : Array.from(customText.trim()).length > 200
            ? t('customTooLong')
            : t('customInvalid')
        : t('selectScenarioError'));
      return;
    }
    setScenarioError('');
    setBusy(true);
    setError('');
    setNotice('');
    lessonSaved.current = false;
    const sessionId = createPracticeSessionId();
    try {
      const options = createSessionOptions(scenario, promptKey, customText, activeLanguage, voiceKey);
      setSession(await createVoiceSession(options));
      setActiveScenario(scenario);
      activeSession.current = { id: sessionId, scenario, promptKey };
    } catch (reason) {
      activeSession.current = null;
      if (reason instanceof VoiceSessionError) {
        setError(t(reason.kind === 'unavailable'
          ? 'voiceUnavailable'
          : reason.kind === 'invalid_response'
            ? 'invalidSession'
            : 'startError'));
      } else {
        setError(t('startError'));
      }
    } finally {
      setBusy(false);
    }
  }, [activeLanguage, customText, promptKey, scenario, t, voiceKey]);

  const returnHome = useCallback(() => {
    setSession(null);
    activeSession.current = null;
    setShowPracticePicker(!user);
  }, [user]);
  const retryLesson = useCallback(async () => {
    setSession(null);
    await startLesson();
  }, [startLesson]);
  const onHeardTutor = useCallback(() => setNotice(''), []);

  const finishLesson = useCallback(async (details: CompletedLessonDetails) => {
    if (lessonSaved.current) return;
    lessonSaved.current = true;
    const active = activeSession.current;
    if (!active) {
      setSession(null);
      setError(t('progressSaveFailed'));
      return;
    }
    const localDay = today();
    const completedSession: PracticeSession = {
      sessionId: active.id,
      scenario: active.scenario,
      promptKey: active.promptKey,
      completedAt: new Date().toISOString(),
      localDay,
      failedAttempts: details.failedAttempts,
      hesitationCount: details.hesitationCount,
      difficultSentences: details.difficultSentences,
      vocabularyTerms: details.vocabularyTerms,
    };
    const updated = completeLesson(progress, localDay, completedSession);
    try {
      repository.writeLocal(updated, user?.id);
    } catch {
      setSession(null);
      setError(t('progressSaveFailed'));
      return;
    }
    setProgress(updated);
    setSession(null);
    setShowPracticePicker(!user);
    activeSession.current = null;
    if (!supabase || !user) {
      setNotice(t('savedProgress'));
      return;
    }
    try {
      let cloud = await repository.readCloud(user.id);
      const cloudSessionIds = new Set(cloud.progress.sessions.map((item) => item.sessionId));
      const pendingSessions = updated.sessions.filter((item) => !cloudSessionIds.has(item.sessionId));
      for (const pending of pendingSessions) {
        await repository.writeCompletedSession(user.id, pending);
      }
      if (pendingSessions.length > 0) cloud = await repository.readCloud(user.id);
      const synchronized = mergeProgress(updated, cloud.progress);
      repository.writeLocal(synchronized, user.id);
      setProgress(synchronized);
      setSyncUnavailable(false);
      setNotice(t('dashboardSyncSaved'));
    } catch {
      setNotice(t('localProgressCloudRetry'));
      setSyncUnavailable(true);
    }
  }, [progress, repository, t, user]);

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(t('signOutFailed'));
        return;
      }
      setUser(null);
      setProgress(repository.readLocal() ?? emptyProgress);
      setGuestImportPending(false);
      setShowPracticePicker(true);
      setSyncUnavailable(false);
      setNotice(t('guestPracticeAvailable'));
    } catch {
      setError(t('signOutFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function mergeGuestProgress() {
    if (!supabase || !user || busy) return;
    setBusy(true);
    setError('');
    try {
      await repository.importGuestProgress(user.id, guestProgress);
      const cloud = await repository.readCloud(user.id);
      const merged = mergeProgress(repository.readLocal(user.id) ?? emptyProgress, cloud.progress);
      repository.writeLocal(merged, user.id);
      setProgress(merged);
      setGuestImportPending(false);
      setSyncUnavailable(false);
      setNotice(t('accountProgressConnected'));
    } catch {
      setError(t('guestImportFailed'));
      setSyncUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  async function keepAccountProgress() {
    if (!user) return;
    setGuestImportPending(false);
    const accountLocal = repository.readLocal(user.id) ?? emptyProgress;
    setProgress(accountLocal);
    setShowPracticePicker(false);
    setNotice(t('guestProgressKept'));
  }

  function practiseScenario(nextScenario: ScenarioId, nextPrompt: PromptKey) {
    setScenario(nextScenario);
    setPromptKey(nextPrompt);
    setShowPracticePicker(true);
    setAuthOpen(false);
    setShowExample(false);
    setError('');
  }

  if (!language) {
    return (
      <main className="app-shell language-gate">
        <a className="brand" href="/" aria-label="FluenZ">
          <span className="brand-mark">F</span><span>FluenZ</span>
        </a>
        <section className="language-choice" aria-labelledby="language-heading">
          <div className="language-spark" aria-hidden="true">Aa</div>
          <h1 id="language-heading">English or हिंदी?</h1>
          <p>Choose the language for buttons and guidance.<br />बटन और निर्देशों के लिए अपनी भाषा चुनें।</p>
          <div className="language-options" aria-label="Language / भाषा">
            <button type="button" className="language-option" onClick={() => chooseLanguage('en')}>
              <span className="language-monogram" aria-hidden="true">EN</span>
              <span>English</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="language-option" onClick={() => chooseLanguage('hi')}>
              <span className="language-monogram hindi-monogram" aria-hidden="true">अ</span>
              <span>हिंदी</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  const streak = currentStreak(progress, today());
  const promptOptions = scenarioPromptOptions[scenario];
  const selectedPrompt = promptOptions.find((option) => option.key === promptKey) ?? promptOptions[0]!;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label={t('brandHome')}>
          <span className="brand-mark">F</span><span>FluenZ</span>
        </a>
        <div className="header-actions">
          <label className="language-select-wrap">
            <span className="sr-only">{t('changeLanguage')}</span>
            <select
              aria-label={t('changeLanguage')}
              value={language}
              disabled={busy || Boolean(session)}
              onChange={(event) => {
                if (event.target.value === 'en' || event.target.value === 'hi') {
                  chooseLanguage(event.target.value);
                }
              }}
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
            </select>
          </label>
          <div
            className="streak-pill"
            role="img"
            aria-label={`${t('streakIconLabel')}: ${t(streak === 1 ? 'streakOne' : 'streak', { count: streak })}`}
          >
            <FlameIcon />
            <span>{t(streak === 1 ? 'streakOne' : 'streak', { count: streak })}</span>
          </div>
        </div>
      </header>

      <div className="voice-choice-row">
        <label className="voice-select-wrap">
          <span>{t('tutorVoice')}</span>
          <select
            aria-label={t('tutorVoiceLabel')}
            value={voiceKey}
            disabled={busy || Boolean(session)}
            onChange={(event) => {
              const choice = tutorVoiceChoices.find((item) => item.key === event.target.value);
              if (choice) setVoiceKey(choice.key);
            }}
          >
            {tutorVoiceChoices.map((choice) => (
              <option key={choice.key} value={choice.key}>{t(choice.nameKey)}</option>
            ))}
          </select>
        </label>
        {user
          ? <span className="account-name">{displayName || 'Learner'}</span>
          : supabase && <button type="button" className="account-button" onClick={() => setAuthOpen((open) => !open)}>{t('addAccount')}</button>}
      </div>

      {session ? (
        <>
          <Suspense fallback={<p className="voice-status" role="status">{t('connecting')}</p>}>
            <VoiceLesson
              session={session}
              scenario={activeScenario}
              promptKey={activeSession.current?.promptKey ?? promptKey}
              uiLanguage={language}
              onHeardTutor={onHeardTutor}
              onComplete={(details) => void finishLesson(details)}
              onExit={returnHome}
              onRetry={() => void retryLesson()}
            />
          </Suspense>
          {error && <p className="message error-message" role="alert">{error}</p>}
        </>
      ) : user && (progressOwnerId !== user.id || cloudLoading) ? (
        <p className="voice-status" role="status">{t('dashboardCloudLoading')}</p>
      ) : user && !showPracticePicker && !guestImportPending ? (
        <>
          <LearningDashboard
            uiLanguage={language}
            progress={progress}
            today={today()}
            displayName={displayName || user.email?.split('@')[0] || 'Learner'}
            syncUnavailable={syncUnavailable}
            onPractice={practiseScenario}
            onSignOut={() => void signOut()}
          />
          {notice && <p className="message notice-message" role="status">{notice}</p>}
          {error && <p className="message error-message" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <section className="welcome">
            <div className="welcome-emblem" aria-hidden="true"><span>F</span><i /></div>
            <p className="eyebrow">{t('welcomeEyebrow')}</p>
            <h1>{t('welcomeTitleLineOne')}<br />{t('welcomeTitleLineTwo')}</h1>
            <p className="welcome-copy">{t('welcomeCopy')}</p>
          </section>

          <section className="practice-section" aria-labelledby="scenario-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t('twoChallenges')}</p>
                <h2 id="scenario-heading">{t('scenarioHeading')}</h2>
                <p>{t('scenarioIntro')}</p>
              </div>
              <div className="progress-summary" aria-label={t('progressLabel')}>
                <span>{t('totalPoints', { count: progress.xp })}</span>
                <span>{t('lessonsComplete', { count: progress.lessonsCompleted })}</span>
              </div>
            </div>

            <fieldset className="scenario-grid">
              <legend className="sr-only">{t('scenarioSelectionLabel')}</legend>
              {scenarios.map((item) => (
                <label
                  className={`scenario-card ${scenario === item.id ? 'scenario-card-selected' : ''} ${item.id === 'custom' ? 'scenario-card-custom' : ''}`}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="scenario"
                    value={item.id}
                    checked={scenario === item.id}
                    onChange={() => {
                      setScenario(item.id);
                      setPromptKey(defaultPromptKey[item.id]);
                      setShowExample(false);
                      setScenarioError('');
                    }}
                  />
                  <span className={`scenario-icon scenario-icon-${item.icon}`}><ScenarioIcon type={item.icon} /></span>
                  <span className="scenario-copy">
                    <strong>{t(item.titleKey)}</strong>
                    <span>{t(item.descriptionKey)}</span>
                  </span>
                  <span className="scenario-check" aria-hidden="true">{scenario === item.id ? '✓' : ''}</span>
                  {item.id === 'custom' && scenario === 'custom' && (
                    <span className="custom-input-wrap">
                      <textarea
                        aria-label={t('scenarioCustomLabel')}
                        aria-invalid={Boolean(scenarioError)}
                        aria-describedby="custom-scenario-count"
                        placeholder={t('customPlaceholder')}
                        value={customText}
                        rows={3}
                        onChange={(event) => {
                          setCustomText(Array.from(event.target.value).slice(0, 200).join(''));
                          setScenarioError('');
                        }}
                      />
                      <span id="custom-scenario-count" className="character-count" aria-live="polite">
                        {t('customCharacterCount', { count: Array.from(customText).length })}
                      </span>
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
            <fieldset className="prompt-picker">
              <legend>{t('promptPickerLabel')}</legend>
              <p className="prompt-picker-help">{t('promptPickerHelp')}</p>
              <div className="prompt-options">
                {promptOptions.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={`prompt-option ${option.key === promptKey ? 'prompt-option-selected' : ''}`}
                    aria-pressed={option.key === promptKey}
                    onClick={() => {
                      setPromptKey(option.key);
                      setShowExample(false);
                    }}
                  >
                    <strong>{t(option.labelKey)}</strong>
                    <span>{t(option.cueKey)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-button prompt-another"
                onClick={() => {
                  const currentIndex = promptOptions.findIndex((option) => option.key === promptKey);
                  setPromptKey(promptOptions[(currentIndex + 1) % promptOptions.length]!.key);
                  setShowExample(false);
                }}
              >
                {t('promptAnother')}
              </button>
              <button
                type="button"
                className="text-button prompt-example-toggle"
                aria-expanded={showExample}
                onClick={() => setShowExample((visible) => !visible)}
              >
                {t(showExample ? 'promptHideExample' : 'promptNeedExample')}
              </button>
              {showExample && (
                <ol className="prompt-examples">
                  {selectedPrompt.targetKeys.map((key) => <li key={key} lang="en">{t(key)}</li>)}
                </ol>
              )}
            </fieldset>
          </section>

          {authOpen && supabase && !user && (
            <AuthPanel
              client={supabase}
              uiLanguage={language}
              busy={busy}
              onBusyChange={setBusy}
              onGuest={() => setAuthOpen(false)}
              onAuthenticated={() => setAuthOpen(false)}
            />
          )}

          {user && showPracticePicker && (
            <button className="text-button dashboard-back" type="button" onClick={() => setShowPracticePicker(false)}>
              {t('dashboardBack')}
            </button>
          )}
          {scenarioError && <p className="message error-message" role="alert">{scenarioError}</p>}
          <button className="primary-button start-button" type="button" onClick={() => void startLesson()} disabled={busy}>
            <span className="button-mic" aria-hidden="true"><MicrophoneIcon /></span>
            {busy ? t('startingLesson') : t('startLesson')}
          </button>
          <p className="mic-note">{t('microphoneNote')}</p>
          {notice && <p className="message notice-message" role="status">{notice}</p>}
          {error && <p className="message error-message" role="alert">{error}</p>}
          {!user && <p className="guest-note">{t('guestMode')}</p>}
          {cloudLoading && <p className="guest-note" role="status">{t('dashboardCloudLoading')}</p>}
        </>
      )}
      {guestImportPending && user && (
        <div className="modal-backdrop">
          <section className="guest-import-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-import-heading">
            <h2 id="guest-import-heading">{t('guestImportTitle')}</h2>
            <p>{t('guestImportDescription', { count: guestProgress.lessonsCompleted })}</p>
            {error && <p className="message error-message" role="alert">{error}</p>}
            <button type="button" className="primary-button" onClick={() => void mergeGuestProgress()} disabled={busy}>
              {busy ? t('sending') : t('guestImportMerge')}
            </button>
            <button type="button" className="secondary-button" onClick={() => void keepAccountProgress()} disabled={busy}>
              {t('guestImportKeep')}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" />
    </svg>
  );
}
