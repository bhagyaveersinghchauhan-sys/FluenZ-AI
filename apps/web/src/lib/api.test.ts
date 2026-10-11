import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceSession } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

it('requests the supported lesson and validates the session response', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        server_url: 'wss://example.livekit.cloud',
        room: 'fluenz-123',
        token: 'short-lived-token',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  const options = {
    scenario: 'custom' as const,
    prompt_key: 'custom_help' as const,
    custom_scenario: 'Ask for a bus ticket',
    ui_language: 'hi' as const,
    voice_key: 'default' as const,
  };
  await expect(createVoiceSession(options)).resolves.toEqual({
    serverUrl: 'wss://example.livekit.cloud',
    room: 'fluenz-123',
    token: 'short-lived-token',
  });
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    lesson: 'core',
    ...options,
  });
});

it('rejects a malformed token response', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ server_url: 'wss://example.livekit.cloud' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  await expect(createVoiceSession({
    scenario: 'cafe',
    prompt_key: 'cafe_classic',
    ui_language: 'en',
    voice_key: 'default',
  })).rejects.toThrow();
});
