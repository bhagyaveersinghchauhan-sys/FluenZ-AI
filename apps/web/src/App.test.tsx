import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/VoiceLesson', () => ({
  default: () => <div data-testid="voice-lesson" />,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('asks for English or Hindi on first use and remembers the choice', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'English or हिंदी?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /हिंदी/ }));

  expect(localStorage.getItem('fluenz-ui-language-v1')).toBe('hi');
  expect(screen.getByRole('heading', { name: 'आप किसका अभ्यास करना चाहेंगे?' })).toBeInTheDocument();
  expect(screen.getByLabelText('ऐप की भाषा')).toHaveValue('hi');
});

it('lets the learner change language and choose a scenario', () => {
  localStorage.setItem('fluenz-ui-language-v1', 'en');
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /Shop/ }));
  expect(screen.getByRole('radio', { name: /Shop/ })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'hi' } });

  expect(screen.getByRole('heading', { name: 'आप किसका अभ्यास करना चाहेंगे?' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /दुकान/ })).toBeChecked();
});

it('blocks an empty custom scenario with localized guidance', () => {
  localStorage.setItem('fluenz-ui-language-v1', 'en');
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /Create your own/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start speaking practice' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Write a short situation');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows a real loading state and a localized API error instead of starting a fake session', async () => {
  localStorage.setItem('fluenz-ui-language-v1', 'hi');
  let finishRequest: ((response: Response) => void) | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
    finishRequest = resolve;
  }));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'बोलने का अभ्यास शुरू करें' }));
  expect(screen.getByRole('button', { name: 'शिक्षक से जुड़ रहे हैं…' })).toBeDisabled();

  finishRequest?.(new Response('unavailable', { status: 503 }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('आवाज़ की सुविधा तैयार नहीं है'));
  expect(screen.queryByRole('heading', { name: 'आपका बोलने का अभ्यास' })).not.toBeInTheDocument();
});

it('sends the selected scenario, interface language, and only the safe voice key', async () => {
  localStorage.setItem('fluenz-ui-language-v1', 'en');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      server_url: 'wss://example.livekit.cloud',
      room: 'fluenz-room',
      token: 'short-token',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /Ask for directions/ }));
  fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: 'बोलने का अभ्यास शुरू करें' }));

  expect(await screen.findByTestId('voice-lesson')).toBeInTheDocument();
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    lesson: 'core',
    prompt_key: 'directions_classic',
    scenario: 'directions',
    ui_language: 'hi',
    voice_key: 'default',
  });
});

it('supports selecting and editing the custom scenario using a bounded field', () => {
  localStorage.setItem('fluenz-ui-language-v1', 'hi');
  render(<App />);
  fireEvent.click(screen.getByRole('radio', { name: /अपनी स्थिति लिखें/ }));
  const input = screen.getByRole('textbox', { name: 'अपनी बातचीत की स्थिति लिखें' });
  fireEvent.change(input, { target: { value: 'बस का टिकट माँगें' } });
  expect(screen.getByText('17/200 अक्षर')).toBeInTheDocument();
  expect(input).toHaveAttribute('placeholder', 'अभ्यास के लिए कोई स्थिति चुनें या अपनी बातचीत लिखें।');
});
