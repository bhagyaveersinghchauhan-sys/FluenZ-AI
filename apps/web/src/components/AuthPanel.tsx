import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { translate, type UiLanguage } from '../lib/i18n';

type AuthPanelProps = {
  client: SupabaseClient;
  uiLanguage: UiLanguage;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onGuest: () => void;
  onAuthenticated: () => void;
};

export default function AuthPanel({
  client,
  uiLanguage,
  busy,
  onBusyChange,
  onGuest,
  onAuthenticated,
}: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const t = (key: string) => translate(uiLanguage, key);
  const hasControlCharacters = (value: string) => Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || (codePoint >= 127 && codePoint <= 159));
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)) {
      setError(t('authEmailInvalid'));
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError(t('authNameRequired'));
      return;
    }
    if (mode === 'signup' && (displayName.trim().length > 80 || hasControlCharacters(displayName))) {
      setError(t('authNameInvalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('authPasswordShort'));
      return;
    }
    onBusyChange(true);
    try {
      const response = mode === 'login'
        ? await client.auth.signInWithPassword({ email: normalizedEmail, password })
        : await client.auth.signUp({
            email: normalizedEmail,
            password,
            options: { data: { display_name: displayName.trim() } },
          });
      if (response.error) {
        setError(t(mode === 'login' ? 'authFailed' : 'authSignupFailed'));
      } else if (mode === 'signup' && !response.data.session) {
        setNotice(t('authSignupConfirm'));
      } else {
        onAuthenticated();
      }
    } catch {
      setError(t('authUnavailable'));
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-heading">
      <h2 id="auth-heading">{t('authTitle')}</h2>
      <p>{t('authDescription')}</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        {mode === 'signup' && (
          <label className="auth-field">
            <span>{t('authName')}</span>
            <input
              autoComplete="name"
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        <label className="auth-field">
          <span>{t('authEmail')}</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>{t('authPassword')}</span>
          <span className="password-control">
            <input
              type={passwordVisible ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={t(passwordVisible ? 'authPasswordHide' : 'authPasswordShow')}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {t(passwordVisible ? 'authPasswordHide' : 'authPasswordShow')}
            </button>
          </span>
        </label>
        {error && <p className="message error-message" role="alert">{error}</p>}
        {notice && <p className="message notice-message" role="status">{notice}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={busy}>
          {busy ? t('sending') : t(mode === 'login' ? 'authLogin' : 'authSignup')}
        </button>
      </form>
      <button
        type="button"
        className="text-button auth-switch"
        disabled={busy}
        onClick={() => {
          setError('');
          setNotice('');
          setMode((current) => current === 'login' ? 'signup' : 'login');
        }}
      >
        {t(mode === 'login' ? 'authSwitchSignup' : 'authSwitchLogin')}
      </button>
      <button type="button" className="secondary-button auth-guest" onClick={onGuest} disabled={busy}>
        {t('authContinueGuest')}
      </button>
    </section>
  );
}
