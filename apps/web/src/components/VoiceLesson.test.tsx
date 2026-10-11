import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const livekit = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    room: {
      localParticipant: { identity: 'learner-1' },
      on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    },
  };
});

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => <>{children}</>,
  RoomAudioRenderer: () => null,
  useRoomContext: () => livekit.room,
  useVoiceAssistant: () => ({ state: 'listening' }),
  useLocalParticipant: () => ({
    localParticipant: { setMicrophoneEnabled: vi.fn(), publishData: vi.fn() },
    isMicrophoneEnabled: true,
  }),
}));

import { RoomEvent } from 'livekit-client';
import VoiceLesson from './VoiceLesson';
import { lessonEventTopic, type LessonEvent } from '../lib/lessonEvents';
import { coachEventTopic } from '../lib/coachEvents';

function publish(event: LessonEvent) {
  publishPacket(new TextEncoder().encode(JSON.stringify(event)), lessonEventTopic);
}

function publishPacket(payload: Uint8Array, topic: string) {
  const listener = livekit.listeners.get(RoomEvent.DataReceived);
  if (!listener) throw new Error('Lesson event listener is not registered.');
  act(() => {
    listener(payload, null, null, topic);
  });
}

function makeEvent(
  phase: LessonEvent['phase'],
  outcome: LessonEvent['outcome'],
  attempt: number,
  failed_attempts: number,
): LessonEvent {
  return { version: 1, type: 'lesson_state', phase, outcome, attempt, failed_attempts };
}

afterEach(() => {
  cleanup();
  livekit.listeners.clear();
  vi.useRealTimers();
});

describe('voice lesson event display', () => {
  it('does not invent an attempt count before a state event and shows the backend hint signal', () => {
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="cafe"
        promptKey="cafe_classic"
        uiLanguage="en"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/tries so far/)).not.toBeInTheDocument();

    publish(makeEvent('repeat_after_me', 'retry', 4, 3));
    expect(screen.getByText('3 tries so far. Keep going at your pace.')).toBeInTheDocument();
    expect(screen.getByText(/Your tutor has a hint/)).toBeInTheDocument();

    publish(makeEvent('name_the_object', 'accepted', 1, 0));
    expect(screen.getByText('0 tries so far. Keep going at your pace.')).toBeInTheDocument();
    expect(screen.queryByText(/Your tutor has a hint/)).not.toBeInTheDocument();

    publish(makeEvent('repeat_after_me', 'retry', 4, 3));
    expect(screen.queryByText(/Your tutor has a hint/)).not.toBeInTheDocument();
    expect(screen.getByText('0 tries so far. Keep going at your pace.')).toBeInTheDocument();
  });

  it('keeps the selected target hidden until the learner asks for an example', () => {
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="directions"
        promptKey="directions_classic"
        uiLanguage="hi"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'जगह का रास्ता पूछें।' })).toBeInTheDocument();
    expect(screen.queryByText('“Excuse me, where is the station?”')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'संकेत चाहिए?' }));
    expect(screen.getByText('“Excuse me, where is the station?”')).toBeInTheDocument();
  });

  it('shows validated Hindi vocabulary and real pause feedback from coach events', () => {
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="cafe"
        promptKey="cafe_classic"
        uiLanguage="hi"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    publishPacket(new TextEncoder().encode(JSON.stringify({
      version: 1,
      type: 'vocabulary',
      sequence: 1,
      cards: [{
        term: 'studying',
        definition: 'Learning by practising.',
        hindi_meaning: 'पढ़ाई',
        example: 'I am studying English.',
      }],
    })), coachEventTopic);
    publishPacket(new TextEncoder().encode(JSON.stringify({
      version: 1,
      type: 'fluency',
      sequence: 2,
      status: 'hint',
      hesitation_count: 2,
      hint: 'What did you want to buy?',
    })), coachEventTopic);

    expect(screen.getByRole('heading', { name: 'नए शब्द' })).toBeInTheDocument();
    expect(screen.getByText('पढ़ाई')).toBeInTheDocument();
    expect(screen.getByText('सोचने के विराम').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('What did you want to buy?')).toBeInTheDocument();
  });

  it('renews duplicate vocabulary cards and prevents stale timers from removing them', async () => {
    vi.useFakeTimers();
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="cafe"
        promptKey="cafe_classic"
        uiLanguage="en"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const sendCard = (sequence: number, definition: string) => publishPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        type: 'vocabulary',
        sequence,
        cards: [{
          term: 'studying',
          definition,
          hindi_meaning: null,
          example: null,
        }],
      })),
      coachEventTopic,
    );

    sendCard(1, 'Learning by practising.');
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    sendCard(2, 'Learning by reading or practising.');
    expect(screen.getByText('Learning by reading or practising.')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole('heading', { name: 'studying' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3800); });
    expect(document.querySelector('.vocabulary-card-fading')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('heading', { name: 'studying' })).not.toBeInTheDocument();
  });

  it('ignores older coach events after a newer state arrived', () => {
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="cafe"
        promptKey="cafe_classic"
        uiLanguage="en"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const sendFluency = (sequence: number, count: number) => publishPacket(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        type: 'fluency',
        sequence,
        status: 'idle',
        hesitation_count: count,
        hint: null,
      })),
      coachEventTopic,
    );
    sendFluency(3, 3);
    sendFluency(2, 1);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders synchronized transcript segments only from the agent', () => {
    render(
      <VoiceLesson
        session={{ serverUrl: 'wss://example.test', room: 'room', token: 'token' }}
        scenario="cafe"
        promptKey="cafe_tea"
        uiLanguage="hi"
        onHeardTutor={vi.fn()}
        onComplete={vi.fn()}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const listener = livekit.listeners.get(RoomEvent.TranscriptionReceived);
    expect(listener).toBeDefined();
    const segment = {
      id: 'subtitle-1',
      text: 'Try saying the sentence.',
      language: 'en',
      startTime: 0,
      endTime: 1,
      final: true,
      firstReceivedTime: 0,
      lastReceivedTime: 1,
    };
    act(() => {
      listener?.([segment], { isAgent: false });
    });
    expect(screen.queryByText('Try saying the sentence.')).not.toBeInTheDocument();

    act(() => {
      listener?.([{ ...segment, id: 'subtitle-2', text: 'Try saying the sentence. इसका मतलब है: वाक्य बोलें।' }], { isAgent: true });
    });
    expect(screen.getByText('Try saying the sentence.')).toBeInTheDocument();
    expect(screen.getByText('इसका मतलब है: वाक्य बोलें।')).toBeInTheDocument();

    act(() => {
      livekit.listeners.get(RoomEvent.ActiveSpeakersChanged)?.([{ identity: 'learner-1' }]);
    });
    expect(screen.queryByText('Try saying the sentence.')).not.toBeInTheDocument();
    expect(screen.getByText('शिक्षक के बोलते समय उनके शब्द यहाँ दिखेंगे।')).toBeInTheDocument();
  });
});
