'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';

const API = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const languages = [
  { code: 'hi', label: 'हिन्दी', icon: '🇮🇳' },
  { code: 'en', label: 'English', icon: '🔤' },
];
const scenarios = [
  { id: 'dukaan', label: 'दुकान', icon: '🛍️' },
  { id: 'doctor', label: 'डॉक्टर', icon: '🩺' },
  { id: 'bus', label: 'बस', icon: '🚌' },
  { id: 'introduction', label: 'परिचय', icon: '👋' },
] as const;

type Scenario = (typeof scenarios)[number]['id'];
type TokenInfo = { serverUrl: string; room: string; token: string };
type Learner = {
  id: string;
  name: string;
  xp: number;
  streak: number;
  mock?: boolean;
  last_active?: string | null;
};
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

const demoChallenges = [
  'Say Hello in English.',
  'Say your name in English.',
  'Ask for a cup of tea.',
  'Ask where the bus goes.',
  'Say how you feel today.',
  'Ask the price of a mango.',
  'Say thank you and goodbye.',
];

function localChallenge() {
  return demoChallenges[Math.floor(Date.now() / 86400000) % demoChallenges.length];
}

function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function Home() {
  const [stage, setStage] = useState<'welcome' | 'home' | 'prompt' | 'session' | 'result'>('welcome');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('hi');
  const [teachingLanguage, setTeachingLanguage] = useState('en');
  const [learnerPrompt, setLearnerPrompt] = useState('');
  const [learner, setLearner] = useState<Learner | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [challenge, setChallenge] = useState('');
  const [xpEarned, setXpEarned] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoSession, setDemoSession] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<Scenario>('introduction');
  const completed = useRef(false);
  const promptRecognition = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('fluenz-learner');
    if (!saved) return;

    let user: Learner;
    try {
      user = JSON.parse(saved) as Learner;
    } catch {
      localStorage.removeItem('fluenz-learner');
      setError('सेव जानकारी नहीं खुली। कृपया अपना नाम फिर से भरें।');
      return;
    }
    setLearner(user);
    setName(user.name);
    setStage('home');
    if (user.mock) {
      setChallenge(localChallenge());
      setNotice('डेमो मोड: प्रगति इसी फ़ोन में सेव होगी।');
      return;
    }

    async function loadHome() {
      try {
        const [progressResponse, challengeResponse] = await Promise.all([
          fetch(`${API}/users/${user.id}/progress`),
          fetch(`${API}/users/${user.id}/challenge`),
        ]);
        if (!progressResponse.ok || !challengeResponse.ok) {
          throw new Error('आपकी जानकारी नहीं खुली। इंटरनेट कनेक्शन जाँचें।');
        }
        const [progress, today] = await Promise.all([
          progressResponse.json() as Promise<Learner>,
          challengeResponse.json() as Promise<{ challenge: string }>,
        ]);
        setLearner(progress);
        localStorage.setItem('fluenz-learner', JSON.stringify(progress));
        setChallenge(today.challenge);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'जानकारी लोड नहीं हुई।');
      }
    }
    void loadHome();
  }, []);

  async function createLearner() {
    if (!name.trim()) {
      setError('पहले अपना नाम लिखें।');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) {
        startLocalLearner();
        return;
      }
      const user = (await response.json()) as Learner;
      setLearner(user);
      localStorage.setItem('fluenz-learner', JSON.stringify(user));
      try {
        const challengeResponse = await fetch(`${API}/users/${user.id}/challenge`);
        if (!challengeResponse.ok) throw new Error('Challenge unavailable');
        const today = (await challengeResponse.json()) as { challenge: string };
        setChallenge(today.challenge);
      } catch {
        setChallenge(localChallenge());
        setNotice('आज की चुनौती इस फ़ोन पर दिखाई जा रही है।');
      }
      setStage('home');
    } catch (reason) {
      if (reason instanceof Error) {
        setNotice('डेमो मोड: सर्वर उपलब्ध नहीं है। प्रगति इसी फ़ोन में सेव होगी।');
      }
      startLocalLearner();
    } finally {
      setLoading(false);
    }
  }

  function startLocalLearner() {
    const user: Learner = {
      id: `demo-${Date.now()}`,
      name: name.trim(),
      xp: 0,
      streak: 0,
      mock: true,
      last_active: null,
    };
    setLearner(user);
    localStorage.setItem('fluenz-learner', JSON.stringify(user));
    setChallenge(localChallenge());
    setError('');
    setNotice((message) => message || 'डेमो मोड: प्रगति इसी फ़ोन में सेव होगी।');
    setStage('home');
  }

  async function beginSession(scenario: Scenario = selectedScenario) {
    if (!learner) {
      setStage('welcome');
      return;
    }
    setError('');
    setLoading(true);
    setSelectedScenario(scenario);
    if (learner.mock) {
      setDemoSession(true);
      setTokenInfo(null);
      completed.current = false;
      setStage('session');
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${API}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: learner.name,
          language,
          teaching_language: teachingLanguage,
          scenario,
          prompt: learnerPrompt.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error('लाइव आवाज़ उपलब्ध नहीं है।');
      }
      setTokenInfo((await response.json()) as TokenInfo);
      setDemoSession(false);
      completed.current = false;
      setStage('session');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'लाइव आवाज़ उपलब्ध नहीं है।');
      setNotice('लाइव आवाज़ उपलब्ध नहीं है। आप डेमो में अभ्यास कर सकते हैं।');
    } finally {
      setLoading(false);
    }
  }

  function startPromptDictation() {
    const browserWindow = window as SpeechRecognitionWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError('बोलकर लिखने की सुविधा इस ब्राउज़र में नहीं है।');
      return;
    }
    const recognition = new Recognition();
    promptRecognition.current = recognition;
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setLearnerPrompt((current) => `${current} ${transcript}`.trim().slice(0, 500));
      }
    };
    recognition.onerror = () => setError('आवाज़ समझ नहीं आई। फिर बोलें या लिखें।');
    recognition.onend = () => { promptRecognition.current = null; };
    setError('');
    try {
      recognition.start();
    } catch {
      setError('माइक्रोफ़ोन शुरू नहीं हुआ। अनुमति जाँचें।');
    }
  }

  function selectSuggestion(prompt: string, scenario: Scenario) {
    setLearnerPrompt(prompt);
    setSelectedScenario(scenario);
    setError('');
  }

  function startMockSession() {
    setError('');
    setNotice('');
    setDemoSession(true);
    setTokenInfo(null);
    completed.current = false;
    setStage('session');
  }

  async function finishSession() {
    if (completed.current) return;
    completed.current = true;
    setTokenInfo(null);
    setStage('result');
    setXpEarned(0);
    if (!learner) return;

    if (learner.mock) {
      const today = localDate();
      const yesterday = localDate(new Date(Date.now() - 86400000));
      const streak = learner.last_active === today
        ? learner.streak
        : learner.last_active === yesterday
          ? learner.streak + 1
          : 1;
      const updated = {
        ...learner,
        xp: learner.xp + 10,
        streak,
        last_active: today,
      };
      setLearner(updated);
      localStorage.setItem('fluenz-learner', JSON.stringify(updated));
      setXpEarned(10);
      return;
    }

    try {
      const [xpResponse, streakResponse] = await Promise.all([
        fetch(`${API}/users/${learner.id}/xp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xp: 10 }),
        }),
        fetch(`${API}/users/${learner.id}/streak`, { method: 'POST' }),
      ]);
      if (!xpResponse.ok || !streakResponse.ok) {
        throw new Error('प्रगति सेव नहीं हुई। इंटरनेट कनेक्शन जाँचें।');
      }
      const [progress, streak] = await Promise.all([
        xpResponse.json() as Promise<Learner>,
        streakResponse.json() as Promise<Learner>,
      ]);
      const updated = { ...progress, streak: streak.streak };
      setLearner(updated);
      localStorage.setItem('fluenz-learner', JSON.stringify(updated));
      setXpEarned(10);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'प्रगति सेव नहीं हुई।');
    }
  }

  function speakChallenge() {
    if (!challenge || !('speechSynthesis' in window)) {
      setError('इस ब्राउज़र में आवाज़ उपलब्ध नहीं है।');
      return;
    }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(challenge);
    speech.lang = 'en-IN';
    window.speechSynthesis.speak(speech);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">F</div>
        <div><h1>FluenZ</h1><p>बोलकर सीखें</p></div>
      </header>

      {stage === 'welcome' && (
        <section className="screen">
          <div className="hero-icon" aria-hidden="true">👋</div>
          <h2>नमस्ते!</h2>
          <p className="intro">बोलकर अंग्रेज़ी सीखें।</p>
          <label className="field-label" htmlFor="name">आपका नाम</label>
          <input
            id="name"
            className="name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="नाम"
            autoComplete="given-name"
            maxLength={60}
          />
          <h3 className="section-title">आपकी भाषा</h3>
          <div className="language-row">
            {languages.map((item) => (
              <button
                type="button"
                key={item.code}
                className={`choice ${language === item.code ? 'selected' : ''}`}
                aria-pressed={language === item.code}
                onClick={() => setLanguage(item.code)}
              >
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
          <h3 className="section-title">क्या सीखें?</h3>
          <div className="language-row">
            {[
              { code: 'en', label: 'English', icon: '🗣️' },
              { code: 'hi', label: 'हिन्दी', icon: '🇮🇳' },
            ].map((item) => (
              <button
                type="button"
                key={item.code}
                className={`choice ${teachingLanguage === item.code ? 'selected' : ''}`}
                aria-pressed={teachingLanguage === item.code}
                onClick={() => setTeachingLanguage(item.code)}
              >
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
          <button type="button" className="primary-button" onClick={createLearner} disabled={loading}>
            {loading ? '…' : 'चलें!'}
          </button>
        </section>
      )}

      {stage === 'home' && (
        <section className="screen">
          {notice && <p className="demo-notice" role="status">{notice}</p>}
          <div className="hero-icon" aria-hidden="true">🏠</div>
          <h2>नमस्ते, {learner?.name}!</h2>
          <div className="stats" aria-label="आपकी प्रगति">
            <div><span aria-hidden="true">⭐</span><b>{learner?.xp ?? 0} XP</b></div>
            <div><span aria-hidden="true">🔥</span><b>{learner?.streak ?? 0} दिन</b></div>
          </div>
          <section className="challenge">
            <span>🎯 आज की चुनौती</span>
            <strong>{challenge || 'चुनौती लोड हो रही है…'}</strong>
            <button type="button" className="speak-challenge" onClick={speakChallenge} disabled={!challenge}>
              🔊 चुनौती सुनें
            </button>
          </section>
          <button type="button" className="home-mic" aria-label="माइक दबाकर अभ्यास शुरू करें" onClick={() => { setError(''); setNotice(''); setStage('prompt'); }}>
            <span aria-hidden="true">🎙️</span>
          </button>
          <p className="mic-caption">माइक दबाएँ और अपनी पसंद का अभ्यास चुनें</p>
        </section>
      )}

      {stage === 'prompt' && (
        <section className="screen">
          <div className="hero-icon" aria-hidden="true">🎙️</div>
          <h2>आज क्या बोलें?</h2>
          <p className="intro">अपना अभ्यास बोलें या लिखें।</p>
          <label className="field-label" htmlFor="practice-prompt">अपनी बात बताएँ</label>
          <textarea
            id="practice-prompt"
            className="prompt-input"
            value={learnerPrompt}
            onChange={(event) => setLearnerPrompt(event.target.value.slice(0, 500))}
            placeholder="जैसे: दुकान पर चाय माँगना सीखना है…"
            maxLength={500}
            rows={3}
          />
          <button type="button" className="dictate-button" onClick={startPromptDictation}>
            🎤　बोलकर बताएँ
          </button>
          <h3 className="section-title">या एक चुनें</h3>
          <div className="scenario-grid">
            {scenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={`scenario prompt-scenario ${selectedScenario === scenario.id ? 'selected' : ''}`}
                aria-pressed={selectedScenario === scenario.id}
                onClick={() => {
                  setSelectedScenario(scenario.id);
                  setLearnerPrompt('');
                }}
                disabled={loading}
              >
                <span aria-hidden="true">{scenario.icon}</span>
                <b>{scenario.label}</b>
              </button>
            ))}
          </div>
          <div className="prompt-suggestions">
            <span>उदाहरण:</span>
            <button type="button" onClick={() => selectSuggestion('I want to buy a cup of tea.', 'dukaan')}>चाय माँगना</button>
            <button type="button" onClick={() => selectSuggestion('I need to tell a doctor that I have a headache.', 'doctor')}>डॉक्टर से बात</button>
            <button type="button" onClick={() => selectSuggestion('I want to ask where this bus is going.', 'bus')}>बस का रास्ता पूछना</button>
          </div>
          <button type="button" className="primary-button" onClick={() => beginSession()} disabled={loading}>
            {loading ? 'जुड़ रहे हैं…' : '🎙️　शिक्षक से बात करें'}
          </button>
          <button type="button" className="secondary-button" onClick={() => setStage('home')}>← वापस</button>
        </section>
      )}

      {stage === 'session' && demoSession && (
        <MockSession
          teachingLanguage={teachingLanguage}
          scenario={selectedScenario}
          learnerPrompt={learnerPrompt}
          onFinish={finishSession}
        />
      )}

      {stage === 'session' && tokenInfo && !demoSession && (
        <>
          <LiveSession
            tokenInfo={tokenInfo}
            onFinish={finishSession}
            onError={(message) => setError(
              /permission|microphone|device|notallowed/i.test(message)
                ? 'माइक की अनुमति दें, फिर दोबारा कोशिश करें।'
                : message,
            )}
          />
          {error && (
            <button
              type="button"
              className="secondary-button"
              onClick={startMockSession}
            >
              डेमो में जारी रखें
            </button>
          )}
        </>
      )}

      {stage === 'result' && (
        <section className="screen result">
          <span aria-hidden="true">🎉</span>
          <h2>बहुत अच्छा!</h2>
          <p>आज आपने {teachingLanguage === 'en' ? 'अंग्रेज़ी' : 'हिन्दी'} बोलने की कोशिश की।</p>
          <div className="stats">
            <div><span aria-hidden="true">⭐</span><b>+{xpEarned} XP</b></div>
            <div><span aria-hidden="true">🔥</span><b>{learner?.streak ?? 0} दिन</b></div>
          </div>
          <button type="button" className="primary-button" onClick={() => { setError(''); setStage('home'); }}>🏠　घर जाएँ</button>
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

function LiveSession({
  tokenInfo,
  onFinish,
  onError,
}: {
  tokenInfo: TokenInfo;
  onFinish: () => void;
  onError: (message: string) => void;
}) {
  return (
    <LiveKitRoom
      serverUrl={tokenInfo.serverUrl}
      token={tokenInfo.token}
      connect
      audio
      onDisconnected={onFinish}
      onError={(error) => onError(error.message)}
    >
      <RoomAudioRenderer />
      <VoiceRoom onFinish={onFinish} onError={onError} />
    </LiveKitRoom>
  );
}

function VoiceRoom({
  onFinish,
  onError,
}: {
  onFinish: () => void;
  onError: (message: string) => void;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const agent = useVoiceAssistant();
  const room = useRoomContext();
  const isSpeaking = agent.state === 'speaking';
  const agentReady = agent.state === 'listening' || isSpeaking;

  async function toggleMic() {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch {
      onError('माइक्रोफ़ोन नहीं खुला। ब्राउज़र की अनुमति जाँचें।');
    }
  }

  async function endSession() {
    await room.disconnect();
    onFinish();
  }

  return (
    <section className="live-view">
      <button
        type="button"
        className={`mic-button ${isSpeaking ? 'speaking' : ''} ${isMicrophoneEnabled ? '' : 'muted'}`}
        onClick={() => void toggleMic()}
        aria-label={isMicrophoneEnabled ? 'माइक्रोफ़ोन बंद करें' : 'माइक्रोफ़ोन चालू करें'}
      >
        <span aria-hidden="true">{isMicrophoneEnabled ? '🎙️' : '🔇'}</span>
      </button>
      <h2>
        {isSpeaking
          ? 'सुनिए…'
          : !isMicrophoneEnabled
            ? 'माइक बंद है'
            : agentReady
              ? 'अब आप बोलिए'
              : 'शिक्षक जुड़ रहे हैं…'}
      </h2>
      <div className={`bars ${isSpeaking ? 'active' : ''}`} aria-label={agent.state} aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      <p>
        {!isMicrophoneEnabled
          ? 'माइक चालू करें, फिर बोलें'
          : agentReady
            ? 'AI शिक्षक आपकी बात सुन रहा है'
            : 'AI शिक्षक से जुड़ रहे हैं'}
      </p>
      <button type="button" className="end-button" onClick={() => void endSession()}>बातचीत पूरी करें</button>
    </section>
  );
}

function MockSession({
  teachingLanguage,
  scenario,
  learnerPrompt,
  onFinish,
}: {
  teachingLanguage: string;
  scenario: Scenario;
  learnerPrompt: string;
  onFinish: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [feedback, setFeedback] = useState('');
  const phrases: Record<Scenario, { en: string; hi: string }> = {
    introduction: { en: 'Hello', hi: 'नमस्ते' },
    dukaan: { en: 'I want tea, please', hi: 'मुझे चाय चाहिए' },
    doctor: { en: 'I have a headache', hi: 'मेरे सिर में दर्द है' },
    bus: { en: 'Where is this bus going?', hi: 'यह बस कहाँ जा रही है?' },
  };
  const phrase = phrases[scenario][teachingLanguage === 'en' ? 'en' : 'hi'];

  function speak(text: string, lang: string) {
    if (!('speechSynthesis' in window)) {
      setFeedback('इस ब्राउज़र में बोलकर सुनाना उपलब्ध नहीं है।');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    const topic = learnerPrompt.trim()
      ? `आपका अभ्यास है: ${learnerPrompt.trim()}.`
      : '';
    speak(`नमस्ते! ${topic} ${phrase} बोलिए।`, 'hi-IN');
    return () => window.speechSynthesis?.cancel();
  }, [learnerPrompt, phrase]);

  function startListening() {
    setListening(true);
    setFeedback('');
    speak('अब आप बोलिए।', 'hi-IN');
  }

  function repeatPhrase() {
    setListening(false);
    setFeedback(`अच्छा बोला! ${phrase}`);
    speak(`अच्छा बोला! ${phrase}`, teachingLanguage === 'en' ? 'en-IN' : 'hi-IN');
  }

  return (
    <section className="live-view">
      <p className="demo-notice">डेमो मोड — बोलकर अभ्यास करें, फिर नीचे दबाएँ।</p>
      <button
        type="button"
        className={`mic-button ${speaking ? 'speaking' : ''} ${listening ? '' : 'muted'}`}
        onClick={startListening}
        aria-label="बोलना शुरू करें"
      >
        <span aria-hidden="true">{listening ? '🎙️' : '🔇'}</span>
      </button>
      <h2>{speaking ? 'सुनिए…' : listening ? 'अब आप बोलिए' : 'बोलने के लिए माइक दबाएँ'}</h2>
      <div className={`bars ${speaking ? 'active' : ''}`} aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
      {feedback && <p aria-live="polite">{feedback}</p>}
      {listening && (
        <button type="button" className="primary-button" onClick={repeatPhrase}>
          मैंने बोल लिया
        </button>
      )}
      <button type="button" className="end-button" onClick={onFinish}>बातचीत पूरी करें</button>
    </section>
  );
}
