import { describe, expect, it } from 'vitest';
import { splitBilingualSubtitle } from './subtitleText';

describe('bilingual subtitles', () => {
  it('preserves actual spoken text while labeling English and Hindi script runs', () => {
    const spoken = 'Try saying the sentence. इसका मतलब है: मुझे चाय चाहिए। Now, try again.';
    const runs = splitBilingualSubtitle(spoken);

    expect(runs.map((run) => run.language)).toEqual(['en', 'hi', 'en']);
    expect(runs.map((run) => run.text)).toEqual([
      'Try saying the sentence. ',
      'इसका मतलब है: मुझे चाय चाहिए। ',
      'Now, try again.',
    ]);
    expect(runs.map((run) => run.text).join('')).toBe(spoken);
  });

  it('does not invent a subtitle for empty output', () => {
    expect(splitBilingualSubtitle('')).toEqual([]);
  });
});
