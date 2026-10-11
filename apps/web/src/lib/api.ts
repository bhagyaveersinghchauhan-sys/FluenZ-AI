import type { SessionOptions } from './sessionOptions';

export type VoiceSession = {
  serverUrl: string;
  room: string;
  token: string;
};

export class VoiceSessionError extends Error {
  constructor(readonly kind: 'unavailable' | 'failed' | 'invalid_response') {
    super(kind);
    this.name = 'VoiceSessionError';
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

export async function createVoiceSession(options: SessionOptions): Promise<VoiceSession> {
  const response = await fetch(`${apiBase}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lesson: 'core', ...options }),
  });
  if (!response.ok) {
    throw new VoiceSessionError(response.status === 503 ? 'unavailable' : 'failed');
  }

  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('server_url' in value) ||
    typeof value.server_url !== 'string' ||
    !('room' in value) ||
    typeof value.room !== 'string' ||
    !('token' in value) ||
    typeof value.token !== 'string'
  ) {
    throw new VoiceSessionError('invalid_response');
  }
  return { serverUrl: value.server_url, room: value.room, token: value.token };
}
