import { useState } from 'react';
import type { FluencyEvent, VocabularyCard } from '../lib/coachEvents';
import { translate, type UiLanguage } from '../lib/i18n';

export type VisibleVocabularyCard = VocabularyCard & {
  key: string;
  fading: boolean;
};

type LearningCoachPanelProps = {
  uiLanguage: UiLanguage;
  cards: VisibleVocabularyCard[];
  fluency: FluencyEvent;
};

export default function LearningCoachPanel({
  uiLanguage,
  cards,
  fluency,
}: LearningCoachPanelProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(uiLanguage, key, values);

  return (
    <aside className="learning-coach" aria-label={t('learningCoachPanel')}>
      <div className="coach-panel-heading">
        <span className="coach-heading-mark" aria-hidden="true">Aa</span>
        <div>
          <h2>{t('liveVocabulary')}</h2>
          <p>{t('vocabularyPanelHint')}</p>
        </div>
        <button
          className="coach-mobile-toggle"
          type="button"
          aria-expanded={mobileExpanded}
          onClick={() => setMobileExpanded((expanded) => !expanded)}
        >
          {t(mobileExpanded ? 'collapseCoach' : 'expandCoach')}
        </button>
      </div>
      <div className={`coach-panel-content ${mobileExpanded ? 'coach-panel-expanded' : ''}`}>
        <section className="vocabulary-list" aria-live="polite" aria-relevant="additions">
          {cards.length === 0
            ? <p className="vocabulary-empty">{t('vocabularyWaiting')}</p>
            : cards.map((card) => (
                <article
                  className={`vocabulary-card ${card.fading ? 'vocabulary-card-fading' : ''}`}
                  key={card.key}
                >
                  <h3>{card.term}</h3>
                  <p className="vocabulary-definition">{card.definition}</p>
                  {uiLanguage === 'hi' && card.hindi_meaning && (
                    <p className="vocabulary-hindi" lang="hi">{card.hindi_meaning}</p>
                  )}
                  {card.example && <p className="vocabulary-example" lang="en">“{card.example}”</p>}
                </article>
              ))}
        </section>
        <section className="fluency-card" aria-label={t('fluencyIndicator')}>
          <div className="fluency-card-title">
            <span className="fluency-wave" aria-hidden="true"><span /><span /><span /><span /></span>
            <h3>{t('fluencyIndicator')}</h3>
          </div>
          <p className="hesitation-count">
            <strong>{fluency.hesitation_count}</strong>
            <span>{t('hesitationPauseCount')}</span>
          </p>
          {fluency.status === 'thinking' && (
            <p className="fluency-thinking" role="status">{t('findingWords')}</p>
          )}
          {fluency.status === 'hint' && fluency.hint && (
            <div className="completion-hint" role="status">
              <span>{t('sentenceHint')}</span>
              <p>{fluency.hint}</p>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
