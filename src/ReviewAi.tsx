// The review build's AI connection (review.ts): the developer's own
// OpenAI-compatible endpoint, key and model, kept only in this browser. The
// game calls that provider directly; no key, no AI (offline crafting).
import { useState } from 'react';
import { REVIEW_AI_DEFAULTS, readReviewAi, saveReviewAi } from './review';

export default function ReviewAi({ compact = false }: { compact?: boolean }) {
  const cur = readReviewAi();
  const [open, setOpen] = useState(!compact);
  const [base, setBase] = useState(cur.base);
  const [key, setKey] = useState(cur.key);
  const [model, setModel] = useState(cur.model);
  const status = cur.key ? `AI connected: ${cur.model}` : 'AI not connected: crafting runs offline';
  if (!open)
    return (
      <div className="review-ai compact">
        <span className="ds-muted">{status}</span>{' '}
        <button className="ds-link" onClick={() => setOpen(true)}>
          {cur.key ? 'change' : 'add your AI key'}
        </button>
      </div>
    );
  return (
    <form
      className="review-ai"
      onSubmit={(e) => {
        e.preventDefault();
        saveReviewAi({ base: base.trim() || REVIEW_AI_DEFAULTS.base, key: key.trim(), model: model.trim() || REVIEW_AI_DEFAULTS.model });
      }}
    >
      <div className="ds-muted">{status}. Your key stays in this browser; the game calls the provider directly.</div>
      <label>
        Endpoint (OpenAI-compatible)
        <input value={base} onChange={(e) => setBase(e.target.value)} placeholder={REVIEW_AI_DEFAULTS.base} spellCheck={false} />
      </label>
      <label>
        API key
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false} />
      </label>
      <label>
        Model
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={REVIEW_AI_DEFAULTS.model} spellCheck={false} />
      </label>
      <div className="review-ai-actions">
        <button className="ds-action go" type="submit">
          <span>Save and reload</span>
        </button>
        {cur.key && (
          <button className="ds-action" type="button" onClick={() => saveReviewAi({ ...cur, key: '' })}>
            <span>Remove key</span>
          </button>
        )}
      </div>
    </form>
  );
}
