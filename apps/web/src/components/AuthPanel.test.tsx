import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthPanel from './AuthPanel';

afterEach(cleanup);

let clientNumber = 0;

function renderAuthPanel() {
  const client = createClient('https://demo.supabase.co', 'public-test-anon-key', {
    auth: { storageKey: `fluenz-auth-test-${++clientNumber}` },
  });
  const onBusyChange = vi.fn();
  const onGuest = vi.fn();
  const onAuthenticated = vi.fn();
  return {
    client,
    onGuest,
    onAuthenticated,
    view: render(
      <AuthPanel
        client={client}
        uiLanguage="hi"
        busy={false}
        onBusyChange={onBusyChange}
        onGuest={onGuest}
        onAuthenticated={onAuthenticated}
      />,
    ),
  };
}

describe('optional account form', () => {
  it('validates an email and password before calling Supabase', async () => {
    const { client } = renderAuthPanel();
    const signIn = vi.spyOn(client.auth, 'signInWithPassword');
    fireEvent.change(screen.getByLabelText('ईमेल'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('पासवर्ड'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'साइन इन करें' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('सही ईमेल पता लिखें।');
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'अतिथि बनकर जारी रखें' })).toBeInTheDocument();
  });

  it('uses Supabase password sign-in and preserves Hindi account messages', async () => {
    const { client, onAuthenticated } = renderAuthPanel();
    const signIn = vi.spyOn(client.auth, 'signInWithPassword').mockRejectedValue(new Error('offline'));
    fireEvent.change(screen.getByLabelText('ईमेल'), { target: { value: 'learner@example.test' } });
    fireEvent.change(screen.getByLabelText('पासवर्ड'), { target: { value: 'safe-demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'साइन इन करें' }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith({
      email: 'learner@example.test',
      password: 'safe-demo-password',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/खाता सेवा उपलब्ध नहीं है/);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('validates and sends a display name during password sign-up', async () => {
    const { client } = renderAuthPanel();
    const signUp = vi.spyOn(client.auth, 'signUp').mockImplementation(
      async () => ({ data: { user: null, session: null }, error: null }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'FluenZ पर नए हैं? खाता बनाएँ' }));
    fireEvent.change(screen.getByLabelText('दिखाने वाला नाम'), { target: { value: 'Asha' } });
    fireEvent.change(screen.getByLabelText('ईमेल'), { target: { value: 'learner@example.test' } });
    fireEvent.change(screen.getByLabelText('पासवर्ड'), { target: { value: 'safe-demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'खाता बनाएँ' }));

    await waitFor(() => expect(signUp).toHaveBeenCalledWith({
      email: 'learner@example.test',
      password: 'safe-demo-password',
      options: { data: { display_name: 'Asha' } },
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/खाते की पुष्टि के लिए ईमेल देखें/);
  });

  it('continues as a guest without invoking authentication', () => {
    const { client, onGuest } = renderAuthPanel();
    const signIn = vi.spyOn(client.auth, 'signInWithPassword');
    fireEvent.click(screen.getByRole('button', { name: 'अतिथि बनकर जारी रखें' }));

    expect(onGuest).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
  });
});
