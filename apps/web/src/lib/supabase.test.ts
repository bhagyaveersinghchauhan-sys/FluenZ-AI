import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('optional Supabase configuration', () => {
  it('stays in guest mode when both public settings are absent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.resetModules();
    const { getSupabaseClient, getSupabaseConfigurationIssue } = await import('./supabase');

    expect(getSupabaseClient()).toBeNull();
    expect(getSupabaseConfigurationIssue()).toBe('');
  });

  it('creates an official client from public configuration and rejects a partial configuration', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-anon-key');
    vi.resetModules();
    const configured = await import('./supabase');
    expect(configured.getSupabaseClient()).not.toBeNull();

    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.resetModules();
    const partial = await import('./supabase');
    expect(partial.getSupabaseClient()).toBeNull();
    expect(partial.getSupabaseConfigurationIssue()).toContain('both its public URL');
  });
});
