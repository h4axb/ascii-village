// The review build (`npm run build:review`, VITE_APP_MODE=review): the game
// alone, for a developer on its own Worker (worker/review.ts). It plays the
// study flow (as /intro/1: intro, skippable, then the quests, order AB) on
// every path, talks to no server of ours, ends with "Finish game" instead of
// the survey, and uses the AI key the developer enters (kept only in their
// browser, the calls go straight to their provider: llmClient.ts).
export const REVIEW = import.meta.env.VITE_APP_MODE === 'review';

export interface ReviewAi {
  base: string; // an OpenAI-compatible endpoint
  key: string;
  model: string;
}
export const REVIEW_AI_DEFAULTS = { base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash-lite' };
const AI_STORE = 'asciia-review-ai';

export function readReviewAi(): ReviewAi {
  try {
    const v = JSON.parse(localStorage.getItem(AI_STORE) ?? 'null') as Partial<ReviewAi> | null;
    return {
      base: (v?.base?.trim() || REVIEW_AI_DEFAULTS.base).replace(/\/$/, ''),
      key: v?.key?.trim() ?? '',
      model: v?.model?.trim() || REVIEW_AI_DEFAULTS.model,
    };
  } catch {
    return { ...REVIEW_AI_DEFAULTS, key: '' };
  }
}
// saved: the game reloads so every AI call uses it
export function saveReviewAi(v: ReviewAi): void {
  try {
    localStorage.setItem(AI_STORE, JSON.stringify(v));
  } catch {
    // storage blocked: nothing to keep it in
  }
  window.location.reload();
}
