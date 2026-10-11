import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyProgress } from '../lib/progress';
import LearningDashboard from './LearningDashboard';

afterEach(cleanup);

describe('personal learning dashboard', () => {
  it('shows honest empty states and does not claim unmeasured timing data', () => {
    render(
      <LearningDashboard
        uiLanguage="en"
        progress={emptyProgress}
        today="2026-10-10"
        displayName="Asha"
        syncUnavailable={false}
        onPractice={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Welcome, Asha' })).toBeInTheDocument();
    expect(screen.getByText('Words from your tutor’s vocabulary cards will appear here.')).toBeInTheDocument();
    expect(screen.getByText('Sentences that needed another try will appear here.')).toBeInTheDocument();
    expect(screen.getByText(/not measured reliably yet/)).toBeInTheDocument();
  });

  it('shows recorded vocabulary meanings and retries the actual difficult prompt', () => {
    const onPractice = vi.fn();
    const progress = {
      ...emptyProgress,
      lessonsCompleted: 1,
      sessions: [{
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        scenario: 'cafe' as const,
        promptKey: 'cafe_menu' as const,
        completedAt: '2026-10-10T09:00:00.000Z',
        localDay: '2026-10-10',
        failedAttempts: 2,
        hesitationCount: 1,
        difficultSentences: [{ sentence: 'Could I see the menu, please?', attempts: 2 }],
        vocabularyTerms: [{
          term: 'recommend',
          definition: 'To suggest something good.',
          hindiMeaning: 'सुझाव देना',
          example: 'What would you recommend?',
        }],
      }],
    };
    render(
      <LearningDashboard
        uiLanguage="en"
        progress={progress}
        today="2026-10-10"
        displayName="Asha"
        syncUnavailable
        onPractice={onPractice}
        onSignOut={vi.fn()}
      />,
    );

    expect(screen.getByText('To suggest something good.')).toBeInTheDocument();
    expect(screen.getByText('सुझाव देना')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Practise again' }));
    expect(onPractice).toHaveBeenCalledWith('cafe', 'cafe_menu');
    expect(screen.getByRole('status')).toHaveTextContent(/Cloud sync is unavailable/);
  });
});
