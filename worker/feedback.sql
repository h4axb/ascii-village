-- Crafting feedback (crafting panel 2), stored by functions/api/feedback.ts.
-- Run once:  npx wrangler d1 execute asciia-feedback --remote --file=worker/feedback.sql
-- `data` holds the whole record (src/feedback/schema.ts); the other columns
-- are copies for sorting and filtering.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  player TEXT NOT NULL,
  link TEXT,
  kind TEXT,
  vote TEXT NOT NULL,
  data TEXT NOT NULL,
  -- the user test's analysis columns (src/feedback/schema.ts designOf,
  -- conditionOf); added by functions/api/feedback.ts to older tables
  participant TEXT,
  run_order TEXT,       -- AB or BA
  condition INTEGER,    -- 1 = first half of the run, 2 = second
  design TEXT,          -- A = pre-clarification, B = post-reflection
  fallback_used INTEGER, -- 1: drawn by the offline fallback, not the AI
  fallback_reason TEXT
);
CREATE INDEX IF NOT EXISTS feedback_at ON feedback (at);
