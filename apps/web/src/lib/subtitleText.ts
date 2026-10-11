export type SubtitleRun = {
  language: 'en' | 'hi';
  text: string;
};

export function splitBilingualSubtitle(text: string): SubtitleRun[] {
  if (!text.trim()) return [];
  const runs: SubtitleRun[] = [];
  for (const character of text) {
    const language = /[\u0900-\u097f]/u.test(character)
      ? 'hi'
      : /[A-Za-z0-9]/u.test(character)
        ? 'en'
        : runs.at(-1)?.language ?? 'en';
    const previous = runs.at(-1);
    if (previous?.language === language) previous.text += character;
    else runs.push({ language, text: character });
  }
  return runs;
}
