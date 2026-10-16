# PulseChat PostgreSQL Database Operations Guide

This document contains all SQL queries for inspecting tables, viewing data, inserting test data across all tables with proper foreign key relationships, and safely cleaning up (deleting) the test data.

---

## 1. Database & Table Inspection Queries

### 1.1 List All Tables
```sql
-- List all user tables in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Or in psql shell:
-- \dt
```

### 1.2 Inspect Schema & Columns for All Tables
```sql
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
ORDER BY table_name, ordinal_position;

-- Or in psql shell for a specific table:
-- \d users
-- \d conversations
-- \d conversation_members
-- \d messages
-- \d conversation_summaries
-- \d summary_messages
-- \d conversation_topics
```

### 1.3 View Row Counts for All Tables
```sql
SELECT 'users' AS table_name, COUNT(*) AS count FROM users
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'conversation_members', COUNT(*) FROM conversation_members
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'conversation_summaries', COUNT(*) FROM conversation_summaries
UNION ALL
SELECT 'summary_messages', COUNT(*) FROM summary_messages
UNION ALL
SELECT 'conversation_topics', COUNT(*) FROM conversation_topics;
```

---

## 2. SELECT Queries (View Data in Each Table)

### 2.1 View `users`
```sql
SELECT id, username, display_name, phone_number, phone_verified, created_at 
FROM users 
ORDER BY id DESC 
LIMIT 20;
```

### 2.2 View `conversations`
```sql
SELECT id, name, is_group, created_by, direct_user1_id, direct_user2_id, created_at 
FROM conversations 
ORDER BY id DESC 
LIMIT 20;
```

### 2.3 View `conversation_members`
```sql
SELECT cm.id, cm.conversation_id, cm.user_id, u.username, cm.role, cm.joined_at 
FROM conversation_members cm
JOIN users u ON cm.user_id = u.id
ORDER BY cm.conversation_id, cm.user_id;
```

### 2.4 View `messages`
```sql
SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender, m.content, m.is_read, m.priority, m.created_at 
FROM messages m
JOIN users u ON m.sender_id = u.id
ORDER BY m.created_at DESC 
LIMIT 50;
```

### 2.5 View `conversation_summaries`
```sql
SELECT id, conversation_id, summary_type, summary_mode, model_name, message_count, processing_time_ms, generated_at, summary_text 
FROM conversation_summaries 
ORDER BY generated_at DESC 
LIMIT 10;
```

### 2.6 View `summary_messages` (Extractive Message Scores)
```sql
SELECT sm.id, sm.summary_id, sm.message_id, sm.importance_score, sm.pagerank_score, sm.core_score, sm.cluster_id, sm.selection_rank, m.content 
FROM summary_messages sm
JOIN messages m ON sm.message_id = m.id
ORDER BY sm.summary_id DESC, sm.selection_rank ASC;
```

### 2.7 View `conversation_topics`
```sql
SELECT id, conversation_id, cluster_id, topic_label, topic_summary, created_at 
FROM conversation_topics 
ORDER BY conversation_id DESC, cluster_id ASC;
```

---

## 3. INSERT Queries (Add Test Data into Each Table)

> **Important:** To satisfy PostgreSQL foreign key constraints, run the insertions in the exact numbered order below. We use explicit ID `99991` and `99992` so the test data is easy to distinguish and safe to delete later.

```sql
BEGIN;

-- ============================================================================
-- STEP 1: Insert Test Users
-- ============================================================================
INSERT INTO users (
    id, 
    username, 
    phone_number, 
    password_hash, 
    display_name, 
    phone_verified
)
VALUES 
    (99991, 'test_user_alpha', '+919999999991', '$2b$12$eX4mP1eH4sHva1u3f0rt3st1ng0n1y', 'Test Alpha', TRUE),
    (99992, 'test_user_beta',  '+919999999992', '$2b$12$eX4mP1eH4sHva1u3f0rt3st1ng0n1y', 'Test Beta',  TRUE)
RETURNING *;


-- ============================================================================
-- STEP 2: Insert Test Conversations (Direct & Group)
-- ============================================================================
-- 2A: Direct 1-on-1 conversation between user 99991 and 99992
INSERT INTO conversations (
    id, 
    name, 
    is_group, 
    created_by, 
    direct_user1_id, 
    direct_user2_id
)
VALUES 
    (99991, NULL, FALSE, 99991, 99991, 99992)
RETURNING *;

-- 2B: Group conversation
INSERT INTO conversations (
    id, 
    name, 
    is_group, 
    created_by
)
VALUES 
    (99992, 'PulseChat QA Release Room', TRUE, 99991)
RETURNING *;


-- ============================================================================
-- STEP 3: Insert Conversation Members
-- ============================================================================
INSERT INTO conversation_members (
    conversation_id, 
    user_id, 
    role
)
VALUES 
    (99991, 99991, 'member'),
    (99991, 99992, 'member'),
    (99992, 99991, 'admin'),
    (99992, 99992, 'member')
RETURNING *;


-- ============================================================================
-- STEP 4: Insert Messages
-- ============================================================================
INSERT INTO messages (
    id, 
    conversation_id, 
    sender_id, 
    content, 
    is_read, 
    priority
)
VALUES 
    (99991, 99991, 99991, 'Hey Beta, did you complete testing the new summarizer pipeline?', FALSE, 0),
    (99992, 99991, 99992, 'Yes Alpha, all tests passed and latency is under 50ms!', TRUE, 1)
RETURNING *;


-- ============================================================================
-- STEP 5: Insert Conversation Summary
-- ============================================================================
INSERT INTO conversation_summaries (
    id, 
    conversation_id, 
    summary, 
    summary_text, 
    summary_type, 
    message_start_id, 
    message_end_id, 
    algorithm_version, 
    processing_time_ms, 
    message_count, 
    last_summarized_message_id, 
    summary_mode, 
    model_name, 
    structured_summary
)
VALUES (
    99991, 
    99991, 
    'Testing for the summarizer pipeline succeeded with latency under 50ms.',
    'Testing for the summarizer pipeline succeeded with latency under 50ms.',
    'graph_extractive',
    99991, 
    99992, 
    'graph-v1', 
    42, 
    2, 
    99992, 
    'gemini_structured', 
    'gemini-1.5-flash',
    '{"overview": "Summarizer testing concluded successfully with verified latency.", "key_decisions": ["Deploy to staging"], "action_items": []}'::jsonb
)
RETURNING *;


-- ============================================================================
-- STEP 6: Insert Summary Messages (Rankings & Scores)
-- ============================================================================
INSERT INTO summary_messages (
    summary_id, 
    message_id, 
    importance_score, 
    pagerank_score, 
    core_score, 
    cluster_id, 
    selection_rank
)
VALUES 
    (99991, 99991, 0.88, 0.45, 0.50, 1, 1),
    (99991, 99992, 0.94, 0.55, 0.60, 1, 2)
RETURNING *;


-- ============================================================================
-- STEP 7: Insert Conversation Topics
-- ============================================================================
INSERT INTO conversation_topics (
    conversation_id, 
    cluster_id, 
    topic_label, 
    topic_summary
)
VALUES (
    99991, 
    1, 
    'Summarizer Validation', 
    'Verification of summarization latency and test suite coverage.'
)
ON CONFLICT (conversation_id, cluster_id) 
DO UPDATE SET 
    topic_label = EXCLUDED.topic_label, 
    topic_summary = EXCLUDED.topic_summary, 
    created_at = NOW()
RETURNING *;

COMMIT;
```

---

## 4. DELETE Queries (Clean Up Test Data)

### Option A: Explicit Clean-up in Reverse Foreign Key Order
Run this block to manually delete the test data in reverse order of creation:

```sql
BEGIN;

-- 1. Delete conversation topics
DELETE FROM conversation_topics 
WHERE conversation_id IN (99991, 99992);

-- 2. Delete summary message associations
DELETE FROM summary_messages 
WHERE summary_id = 99991;

-- 3. Delete conversation summaries
DELETE FROM conversation_summaries 
WHERE id = 99991 OR conversation_id IN (99991, 99992);

-- 4. Delete messages
DELETE FROM messages 
WHERE conversation_id IN (99991, 99992) OR id IN (99991, 99992);

-- 5. Delete conversation members
DELETE FROM conversation_members 
WHERE conversation_id IN (99991, 99992) OR user_id IN (99991, 99992);

-- 6. Delete conversations
DELETE FROM conversations 
WHERE id IN (99991, 99992);

-- 7. Delete users
DELETE FROM users 
WHERE id IN (99991, 99992);

COMMIT;
```

### Option B: Fast Cascading Clean-up
If `ON DELETE CASCADE` is set on foreign keys (as defined in `002_conversation_summaries.sql`):
```sql
BEGIN;

-- Deleting the conversations cascades to conversation_members, messages, summaries, and topics
DELETE FROM conversations WHERE id IN (99991, 99992);

-- Deleting test users
DELETE FROM users WHERE id IN (99991, 99992);

COMMIT;
```

---

## 5. Verification Query (Check If Test Data Still Exists)

```sql
SELECT 
    (SELECT COUNT(*) FROM users WHERE id IN (99991, 99992)) AS remaining_users,
    (SELECT COUNT(*) FROM conversations WHERE id IN (99991, 99992)) AS remaining_conversations,
    (SELECT COUNT(*) FROM messages WHERE id IN (99991, 99992)) AS remaining_messages,
    (SELECT COUNT(*) FROM conversation_summaries WHERE id = 99991) AS remaining_summaries;
```
If the output shows all zeroes (`0`), the database is completely clean!
