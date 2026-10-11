import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;
let configurationIssue = '';

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (Boolean(url) !== Boolean(anonKey)) {
    configurationIssue = 'Supabase needs both its public URL and publishable key.';
    client = null;
    return client;
  }
  if (!url || !anonKey) {
    client = null;
    return client;
  }
  try {
    client = createClient(url, anonKey);
  } catch {
    configurationIssue = 'Supabase settings are invalid. Guest progress is still available.';
    client = null;
  }
  return client;
}

export function getSupabaseConfigurationIssue(): string {
  return configurationIssue;
}
