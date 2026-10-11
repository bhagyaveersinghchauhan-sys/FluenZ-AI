import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const accountProgress = {
    xp: 70,
    streak: 4,
    lessonsCompleted: 7,
    lastActive: '2026-10-10',
    sessions: [],
  };
  const guestProgress = {
    xp: 0,
    streak: 0,
    lessonsCompleted: 0,
    lastActive: null,
    sessions: [],
  };
  let authStateChanged: ((event: string, session: unknown) => void) | null = null;
  const auth = {
    onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
      authStateChanged = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    getSession: vi.fn(async () => ({
      data: {
        session: {
          user: {
            id: 'user-asha',
            email: 'asha@example.test',
            user_metadata: { display_name: 'Asha' },
          },
        },
      },
      error: null,
    })),
    signOut: vi.fn(async () => {
      authStateChanged?.('SIGNED_OUT', null);
      return { error: null };
    }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
  };
  return {
    accountProgress,
    guestProgress,
    auth,
    supabase: { auth },
    getAuthStateChanged: () => authStateChanged,
  };
});

vi.mock('./lib/supabase', () => ({
  getSupabaseClient: () => mocks.supabase,
  getSupabaseConfigurationIssue: () => '',
}));

vi.mock('./lib/progressRepository', () => ({
  createProgressRepository: () => ({
    readLocal: (userId?: string) => userId ? mocks.accountProgress : mocks.guestProgress,
    writeLocal: vi.fn(),
    readCloud: async () => ({ progress: mocks.accountProgress, displayName: 'Asha' }),
    writeProfile: vi.fn(),
    writeCompletedSession: vi.fn(),
    importGuestProgress: vi.fn(),
  }),
}));

import App from './App';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

it('restores the Supabase session to a private dashboard and clears it on logout', async () => {
  localStorage.setItem('fluenz-ui-language-v1', 'en');
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Welcome, Asha' })).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Welcome, Asha' })).not.toBeInTheDocument());
  expect(screen.getByText('Guest practice · progress stays on this device')).toBeInTheDocument();
  expect(screen.queryByText('70')).not.toBeInTheDocument();
  expect(mocks.getAuthStateChanged()).not.toBeNull();
});
