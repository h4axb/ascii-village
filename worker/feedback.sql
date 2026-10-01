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
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_at ON feedback (at);
