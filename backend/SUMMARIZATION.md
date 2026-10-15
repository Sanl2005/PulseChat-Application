# PulseChat Phase 2: graph extractive summaries

Apply `migrations/002_conversation_summaries.sql` to the existing PostgreSQL database before calling the summary API. No existing chat table is changed.

## Run

The feature has no new runtime package dependencies. Start the backend with `npm start` and the frontend with `npm run dev`. The client sends the existing JWT as `Authorization: Bearer <token>`.

`POST /api/conversations/:conversationId/summarize` generates and stores a new graph extractive summary. It accepts optional `{ "maxMessages": 6 }`. `GET /api/conversations/:conversationId/summary` returns the newest summary; `/summary/details` additionally returns source messages and topics. `GET /api/messages/:messageId/importance` returns the newest stored importance record visible to the current user.

## Method

Every non-empty message is a graph node. The directed edge from earlier message *i* to later message *j* is

`W(i,j) = a*S(i,j) + b*E(i,j) + c*exp(-lambda*delta_t) + d*R(i,j)`.

`S` is a cross-speaker transition, `E` cosine semantic similarity above a threshold, and `R` is an explicit reply (automatically used if the source schema later gains `reply_to_message_id`). The default semantic embedding is a deterministic hashed token vector so it is lightweight, local, and cache-compatible; it may be replaced by a local MiniLM adapter without changing graph selection. Configuration and parameter rationale live in `summarization/graphSummarizer.js`.

The primary graph remains asymmetric for PageRank. For spectral clustering only, it explicitly uses `(W + W-transpose)/2`, then normalized two-hop adjacency features as a practical sparse approximation of the low-frequency Laplacian space, followed by k-means. Core score is normalized total weighted connectivity, with an intra-cluster reinforcement factor. Weighted Personalized PageRank uses that core score as personalization. Final normalized importance combines PageRank, core, recency, reference, and relevance scores. MMR selects high-scoring messages while penalizing embedding redundancy and encouraging unrepresented clusters. Selected messages are chronologically ordered and mapped in `summary_messages`.

## Example

For “We chose PostgreSQL”, “I will finish the schema Friday”, and “Authentication is working”, the graph can contain speaker/temporal edges between adjacent messages and a semantic edge between the first two. MMR can select the database decision, deadline, and API status as the extractive summary, each retaining its original `message_id` for **View source**.

## Performance and limits

Semantic comparisons are bounded to a configurable recent-message window (80 by default), yielding O(n*w) instead of O(n²). The current initial implementation recomputes a conversation at request time and stores `last_summarized_message_id` for the next incremental phase. Hashed embeddings trade semantic quality for zero model-download and dependency cost. Future work: a local MiniLM adapter with embedding-cache table, a sparse eigensolver/Chung directed Laplacian, reply/mention schema support, and optional grounded LLM verbalization that only receives MMR-selected evidence.

Run unit tests with `npm test`.
