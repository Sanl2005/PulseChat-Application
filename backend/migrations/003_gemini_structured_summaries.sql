ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS summary_mode VARCHAR(40) NOT NULL DEFAULT 'extractive_fallback';
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS model_name VARCHAR(120);
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS structured_summary JSONB;
