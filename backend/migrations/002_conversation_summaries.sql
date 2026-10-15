-- Phase 2: graph-based extractive summaries. Apply after the existing schema.
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    summary_type VARCHAR(40) NOT NULL DEFAULT 'graph_extractive',
    message_start_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    message_end_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    algorithm_version VARCHAR(80) NOT NULL,
    processing_time_ms INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_summarized_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL
);
-- Upgrade installations that already created an earlier summary table.
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS summary_text TEXT;
-- `summary` is retained for compatibility with PulseChat's earlier summary
-- table. New writes populate it alongside the richer `summary_text` field.
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS summary TEXT;
UPDATE conversation_summaries SET summary_text = summary WHERE summary_text IS NULL AND summary IS NOT NULL;
UPDATE conversation_summaries SET summary = COALESCE(summary, summary_text, '') WHERE summary IS NULL;
ALTER TABLE conversation_summaries ALTER COLUMN summary SET DEFAULT '';
ALTER TABLE conversation_summaries ALTER COLUMN summary SET NOT NULL;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS summary_type VARCHAR(40) NOT NULL DEFAULT 'graph_extractive';
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS message_start_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS message_end_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(80) NOT NULL DEFAULT 'graph-v1';
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS last_summarized_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversation_summaries_conversation_generated_idx ON conversation_summaries (conversation_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS summary_messages (
    id BIGSERIAL PRIMARY KEY,
    summary_id BIGINT NOT NULL REFERENCES conversation_summaries(id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    importance_score DOUBLE PRECISION NOT NULL,
    pagerank_score DOUBLE PRECISION NOT NULL,
    core_score DOUBLE PRECISION NOT NULL,
    cluster_id INTEGER NOT NULL,
    selection_rank INTEGER NOT NULL,
    UNIQUE (summary_id, message_id)
);
CREATE INDEX IF NOT EXISTS summary_messages_summary_rank_idx ON summary_messages (summary_id, selection_rank);
CREATE INDEX IF NOT EXISTS summary_messages_message_idx ON summary_messages (message_id);

CREATE TABLE IF NOT EXISTS conversation_topics (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    cluster_id INTEGER NOT NULL,
    topic_label TEXT,
    topic_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, cluster_id)
);
