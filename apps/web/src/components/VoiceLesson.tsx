import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { Participant, TranscriptionSegment } from 'livekit-client';
import {
  coachEventTopic,
  parseCoachEvent,
  type FluencyEvent,
  type VocabularyCard,
} from '../lib/coachEvents';
import { lessonCommandTopic, isNewerLessonEvent, parseLessonEvent, replayCommand } from '../lib/lessonEvents';
import type { LessonEvent } from '../lib/lessonEvents';
import type { VoiceSession } from '../lib/api';
import { translate, type UiLanguage } from '../lib/i18n';
import type { VocabularyPracticeTerm } from '../lib/progress';
import { findPromptOption, type PromptKey, type ScenarioId } from '../lib/sessionOptions';
import { splitBilingualSubtitle } from '../lib/subtitleText';
import LearningCoachPanel, { type VisibleVocabularyCard } from './LearningCoachPanel';

export type CompletedLessonDetails = {
  failedAttempts: number;
  hesitationCount: number;
  difficultSentences: { sentence: string; attempts: number }[];
  vocabularyTerms: VocabularyPracticeTerm[];
};

type VoiceLessonProps = {
  session: VoiceSession;
  scenario: ScenarioId;
  promptKey: PromptKey;
  uiLanguage: UiLanguage;
  onHeardTutor: () => void;
  onComplete: (details: CompletedLessonDetails) => void;
  onExit: () => void;
  onRetry: () => void;
};

export default function VoiceLesson(props: VoiceLessonProps) {
  const ending = useRef(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [microphoneError, setMicrophoneError] = useState(false);

  return (
    <LiveKitRoom
      serverUrl={props.session.serverUrl}
      token={props.session.token}
      connect
      audio
      onError={() => setConnectionLost(true)}
      onDisconnected={() => {
        if (!ending.current) setConnectionLost(true);
      }}
      onMediaDeviceFailure={(_failure, kind) => {
        if (kind === 'audioinput') setMicrophoneError(true);
      }}
    >
      <RoomAudioRenderer />
      <VoiceControls
        {...props}
        connectionLost={connectionLost}
        microphoneError={microphoneError}
        onMicrophoneError={setMicrophoneError}
        onConnectionLostChange={setConnectionLost}
        onComplete={(details) => {
          ending.current = true;
          props.onComplete(details);
        }}
        onExit={() => {
          ending.current = true;
          props.onExit();
        }}
        onRetry={() => {
          ending.current = true;
          props.onRetry();
        }}
      />
    </LiveKitRoom>
  );
}

function VoiceControls({
  scenario,
  promptKey,
  uiLanguage,
  connectionLost,
  microphoneError,
  onMicrophoneError,
  onConnectionLostChange,
  onHeardTutor,
  onComplete,
  onExit,
  onRetry,
}: Omit<VoiceLessonProps, 'session'> & {
  connectionLost: boolean;
  microphoneError: boolean;
  onMicrophoneError: (failed: boolean) => void;
  onConnectionLostChange: (lost: boolean) => void;
}) {
  const room = useRoomContext();
  const assistant = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [lessonEvent, setLessonEvent] = useState<LessonEvent | null>(null);
  const currentEvent = useRef<LessonEvent | null>(null);
  const [heardTutor, setHeardTutor] = useState(false);
  const [subtitleText, setSubtitleText] = useState('');
  const [learnerSpeaking, setLearnerSpeaking] = useState(false);
  const [exampleVisible, setExampleVisible] = useState(false);
  const [commandError, setCommandError] = useState(false);
  const [vocabularyCards, setVocabularyCards] = useState<VisibleVocabularyCard[]>([]);
  const [fluency, setFluency] = useState<FluencyEvent>({
    version: 1,
    type: 'fluency',
    sequence: 0,
    status: 'idle',
    hesitation_count: 0,
    hint: null,
  });
  const latestCoachSequence = useRef(0);
  const spokenSegments = useRef(new Map<string, TranscriptionSegment>());
  const failedAttempts = useRef(0);
  const difficultSentences = useRef(new Map<string, number>());
  const vocabularyTerms = useRef(new Map<string, VocabularyPracticeTerm>());
  const cardTimers = useRef(new Map<string, {
    fadeTimer: ReturnType<typeof setTimeout> | null;
    removeTimer: ReturnType<typeof setTimeout> | null;
  }>());
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(uiLanguage, key, values);

  const addVocabularyCard = useCallback((card: VocabularyCard) => {
    const key = card.term.normalize('NFKC').toLocaleLowerCase();
    const previousTimer = cardTimers.current.get(key);
    if (previousTimer) {
      if (previousTimer.fadeTimer !== null) clearTimeout(previousTimer.fadeTimer);
      if (previousTimer.removeTimer !== null) clearTimeout(previousTimer.removeTimer);
    }
    const timer = {
      fadeTimer: null as ReturnType<typeof setTimeout> | null,
      removeTimer: null as ReturnType<typeof setTimeout> | null,
    };
    cardTimers.current.set(key, timer);
    timer.fadeTimer = setTimeout(() => {
      if (cardTimers.current.get(key) !== timer) return;
      setVocabularyCards((current) =>
        current.map((item) => item.key === key ? { ...item, fading: true } : item),
      );
      timer.removeTimer = setTimeout(() => {
        if (cardTimers.current.get(key) !== timer) return;
        cardTimers.current.delete(key);
        setVocabularyCards((current) => current.filter((item) => item.key !== key));
      }, 280);
    }, 5000);

    setVocabularyCards((current) => {
      const next = [{ ...card, key, fading: false }, ...current.filter((item) => item.key !== key)];
      const visible = next.slice(0, 3);
      for (const removed of next.slice(3)) {
        const removedTimer = cardTimers.current.get(removed.key);
        if (removedTimer) {
          if (removedTimer.fadeTimer !== null) clearTimeout(removedTimer.fadeTimer);
          if (removedTimer.removeTimer !== null) clearTimeout(removedTimer.removeTimer);
          cardTimers.current.delete(removed.key);
        }
      }
      return visible;
    });
  }, []);

  useEffect(() => {
    const timers = cardTimers.current;
    const onReconnecting = () => onConnectionLostChange(true);
    const onReconnected = () => onConnectionLostChange(false);
    const onTranscription = (
      segments: TranscriptionSegment[],
      participant?: Participant,
    ) => {
      if (!participant?.isAgent) return;
      for (const segment of segments) {
        if (!segment.final || !segment.text.trim()) continue;
        spokenSegments.current.set(segment.id, segment);
      }
      const latest = [...spokenSegments.current.values()]
        .sort((left, right) => left.startTime - right.startTime)
        .slice(-20);
      setSubtitleText(latest.map((segment) => segment.text).join(' ').trim());
      setLearnerSpeaking(false);
    };
    const onActiveSpeakers = (participants: Participant[]) => {
      const isLearnerSpeaking = participants.some(
        (participant) => participant.identity === room.localParticipant.identity,
      );
      if (isLearnerSpeaking) {
        spokenSegments.current.clear();
        setSubtitleText('');
        setLearnerSpeaking(true);
      }
    };
    const onData = (
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic === coachEventTopic) {
        const event = parseCoachEvent(payload, topic);
        if (!event || event.sequence <= latestCoachSequence.current) return;
        latestCoachSequence.current = event.sequence;
        if (event.type === 'vocabulary') {
          for (const card of event.cards) {
            addVocabularyCard(card);
            const key = card.term.normalize('NFKC').toLocaleLowerCase();
            if (vocabularyTerms.current.size < 30 || vocabularyTerms.current.has(key)) {
              vocabularyTerms.current.set(key, {
                term: card.term,
                definition: card.definition,
                hindiMeaning: card.hindi_meaning,
                example: card.example,
              });
            }
          }
        } else {
          setFluency(event);
        }
        return;
      }
      if (topic !== 'fluenz.lesson.v1') return;
      const event = parseLessonEvent(payload, topic);
      if (!event) {
        setCommandError(true);
        return;
      }
      if (!isNewerLessonEvent(currentEvent.current, event)) return;
      currentEvent.current = event;
      setLessonEvent(event);
      setHeardTutor(false);
      setExampleVisible(false);
      if (event.outcome === 'retry') {
        failedAttempts.current += 1;
        const targetIndex = event.phase === 'name_the_object' || event.phase === 'skipped' ? 1 : 0;
        const sentence = findPromptOption(promptKey).targets[targetIndex];
        difficultSentences.current.set(sentence, (difficultSentences.current.get(sentence) ?? 0) + 1);
      }
    };
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.TranscriptionReceived, onTranscription);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.TranscriptionReceived, onTranscription);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      for (const timer of timers.values()) {
        if (timer.fadeTimer !== null) clearTimeout(timer.fadeTimer);
        if (timer.removeTimer !== null) clearTimeout(timer.removeTimer);
      }
      timers.clear();
    };
  }, [addVocabularyCard, onConnectionLostChange, promptKey, room]);

  useEffect(() => {
    if (assistant.state === 'speaking') {
      setHeardTutor(true);
      onHeardTutor();
    }
  }, [assistant.state, onHeardTutor]);

  async function toggleMicrophone() {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      onMicrophoneError(false);
    } catch {
      onMicrophoneError(true);
    }
  }

  async function replayPrompt() {
    try {
      await localParticipant.publishData(replayCommand(), {
        reliable: true,
        topic: lessonCommandTopic,
      });
      setCommandError(false);
    } catch {
      setCommandError(true);
    }
  }

  const failed = connectionLost || assistant.state === 'failed' || assistant.state === 'disconnected';
  const status = microphoneError
    ? t('microphonePermission')
    : assistant.state === 'failed' || assistant.state === 'disconnected'
      ? t('connectionLost')
      : connectionLost
        ? t('reconnecting')
        : assistant.state === 'speaking'
          ? t('tutorSpeaking')
          : assistant.state === 'thinking'
            ? t('tutorThinking')
            : assistant.state === 'listening'
              ? t('listening')
              : t('connecting');

  const selectedPrompt = findPromptOption(promptKey);
  const targetIndex = lessonEvent?.phase === 'name_the_object' || lessonEvent?.phase === 'skipped' ? 1 : 0;
  const currentTarget = selectedPrompt.targets[targetIndex];
  const subtitleRuns = splitBilingualSubtitle(subtitleText);
  const isObjectChallenge =
    lessonEvent?.phase === 'name_the_object' || lessonEvent?.phase === 'skipped';
  const complete = lessonEvent?.phase === 'completed' && heardTutor;
  const skipped = lessonEvent?.phase === 'skipped';
  const firstChallengeDone =
    lessonEvent?.phase === 'name_the_object' ||
    lessonEvent?.phase === 'completed' ||
    (lessonEvent?.phase === 'skipped' && lessonEvent.outcome === 'accepted');
  const hintReady =
    lessonEvent?.outcome === 'retry' && lessonEvent.failed_attempts >= 3;
  let outcomeMessage = '';
  if (skipped && lessonEvent?.outcome === 'accepted') {
    outcomeMessage = t('acceptedAfterSkip');
  } else if (lessonEvent?.outcome === 'unclear') {
    outcomeMessage = t('unclearFeedback');
  } else if (lessonEvent?.outcome === 'retry') {
    outcomeMessage = t('retryFeedback');
  } else if (lessonEvent?.phase === 'name_the_object' && lessonEvent.outcome === 'accepted') {
    outcomeMessage = t('acceptedFirst');
  } else if (lessonEvent?.outcome === 'completed') {
    outcomeMessage = t('completedFeedback');
  } else if (lessonEvent?.outcome === 'skipped') {
    outcomeMessage = t('skippedFeedback');
  }

  return (
    <div className="lesson-layout">
    <section className="lesson-panel" aria-live="polite">
      <div className="lesson-intro">
        <p className="eyebrow">{t('twoChallenges')}</p>
        <h1>{t('lessonTitle')}</h1>
        <div className="lesson-steps" aria-label={t('twoChallenges')}>
          <span className={firstChallengeDone ? 'step-done' : 'step-current'} aria-current={!firstChallengeDone ? 'step' : undefined}>
            <b>1</b><small>{t('lessonStepOne')}</small>
          </span>
          <span className={lessonEvent?.phase === 'completed' ? 'step-done' : isObjectChallenge ? 'step-current' : ''} aria-current={isObjectChallenge ? 'step' : undefined}>
            <b>2</b><small>{t('lessonStepTwo')}</small>
          </span>
        </div>
      </div>

      <div className={`lesson-visual ${assistant.state === 'speaking' ? 'lesson-visual-speaking' : ''}`}>
        {isObjectChallenge && scenario === 'cafe'
          ? <img className="object-picture" src="/apple.svg" alt={t('applePicture')} />
          : isObjectChallenge
            ? <div className="lesson-scenario-icon" aria-hidden="true"><ScenarioIcon type={scenario} /></div>
            : <button
                className="voice-orb"
                type="button"
                onClick={() => void toggleMicrophone()}
                aria-label={isMicrophoneEnabled ? t('microphoneOn') : t('microphoneOff')}
              >
                <MicrophoneIcon muted={!isMicrophoneEnabled} />
              </button>}
      </div>

      <p className="eyebrow lesson-challenge-label">
        {isObjectChallenge ? t('challengeNumberTwo') : t('challengeNumberOne')}
      </p>
      <h2>{t(selectedPrompt.cueKey)}</h2>
      <p className="lesson-hint">{isObjectChallenge ? t('sayNextSentence') : t('listenAndRepeat')}</p>
      <button
        type="button"
        className="text-button example-toggle"
        aria-expanded={exampleVisible}
        onClick={() => setExampleVisible((visible) => !visible)}
      >
        {t(exampleVisible ? 'promptHideExample' : 'promptNeedExample')}
      </button>
      {exampleVisible && <p className="lesson-example" lang="en">“{currentTarget}”</p>}
      <p className={`voice-status ${failed ? 'voice-status-error' : ''}`} role="status">{status}</p>
      <section className="tutor-subtitles" aria-label={t('tutorSubtitles')} aria-live="polite">
        {subtitleRuns.length === 0
          ? <p>{learnerSpeaking ? t('subtitleListening') : t('subtitleWaiting')}</p>
          : subtitleRuns.map((run, index) => (
              <p key={`${index}-${run.language}`} lang={run.language}>
                <span>{t(run.language === 'hi' ? 'subtitleHindi' : 'subtitleEnglish')}</span>
                <span className="tutor-subtitle-text">{run.text}</span>
              </p>
            ))}
      </section>

      {lessonEvent && (
        <div className="attempt-status" role="status" aria-label={t('progressLabel')}>
          <span className="attempt-dot" aria-hidden="true" />
          <span>{t('attemptCount', { count: lessonEvent.failed_attempts })}</span>
        </div>
      )}
      {hintReady && (
        <aside className="hint-callout" role="status">
          <span className="hint-symbol" aria-hidden="true">i</span>
          <p>{t('hintReady')}</p>
        </aside>
      )}
      {outcomeMessage && <p className="lesson-feedback">{outcomeMessage}</p>}
      {commandError && <p className="message error-message" role="alert">{t('commandError')}</p>}

      {microphoneError && (
        <button type="button" className="secondary-button" onClick={() => void toggleMicrophone()}>
          {t('microphoneRetry')}
        </button>
      )}
      {!failed && lessonEvent && lessonEvent.phase !== 'completed' && !skipped && (
        <button type="button" className="secondary-button replay-button" onClick={() => void replayPrompt()}>
          <SpeakerIcon />{t('replayPrompt')}
        </button>
      )}
      {failed && (
        <button type="button" className="secondary-button" onClick={onRetry}>
          {t('reconnect')}
        </button>
      )}
      <button
        type="button"
        className="primary-button"
        onClick={() => complete
          ? onComplete({
              failedAttempts: failedAttempts.current,
              hesitationCount: fluency.hesitation_count,
              difficultSentences: [...difficultSentences.current].map(([sentence, attempts]) => ({ sentence, attempts })),
              vocabularyTerms: [...vocabularyTerms.current.values()],
            })
          : onExit()}
        disabled={!complete && !failed && !skipped}
      >
        {complete ? t('finishLesson') : failed || skipped ? t('endSession') : t('continueLesson')}
      </button>
      {!failed && <button type="button" className="text-button" onClick={onExit}>{t('endSession')}</button>}
    </section>
      <LearningCoachPanel uiLanguage={uiLanguage} cards={vocabularyCards} fluency={fluency} />
    </div>
  );
}

function MicrophoneIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="18" y="6" width="12" height="25" rx="6" />
      <path d="M10 23a14 14 0 0 0 28 0M24 37v6m-8 0h16" />
      {muted && <path d="m8 8 32 32" />}
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" />
    </svg>
  );
}

function ScenarioIcon({ type }: { type: ScenarioId }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {type === 'shop'
        ? <><path d="M10 17h28l-3 7H13z" /><path d="M14 24v16h20V24M20 40V29h8v11M10 17l3-8h22l3 8" /></>
        : type === 'introduce'
          ? <><circle cx="19" cy="16" r="7" /><path d="M6 39a13 13 0 0 1 26 0M31 14a7 7 0 0 1 0 14m2 4a12 12 0 0 1 9 7" /></>
          : type === 'directions'
            ? <><path d="M24 42s14-13 14-25a14 14 0 0 0-28 0c0 12 14 25 14 25z" /><circle cx="24" cy="17" r="5" /></>
            : type === 'custom'
              ? <><path d="M11 37 13 29 32 10a4 4 0 0 1 6 6L19 35z" /><path d="m28 14 6 6M11 40h27" /></>
              : <><path d="M12 18h21v9a8 8 0 0 1-8 8h-5a8 8 0 0 1-8-8z" /><path d="M33 21h3a5 5 0 0 1 0 10h-4M17 10v4m8-5v5" /></>}
    </svg>
  );
}
