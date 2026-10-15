const test = require("node:test");
const assert = require("node:assert/strict");
const { cosine, embed, preprocess, buildGraph, personalizedPageRank, selectMmr, summarize } = require("./graphSummarizer");
const { selectedMessagePayload, validateStructuredSummary, generateStructuredSummary, extractiveFallback, describeGeminiError } = require("./geminiService");

const messages = [
    { id: 1, conversation_id: 7, sender_id: 1, sender_name: "Ada", content: "We decided to use PostgreSQL for the database.", created_at: "2026-01-01T10:00:00Z" },
    { id: 2, conversation_id: 7, sender_id: 2, sender_name: "Lin", content: "PostgreSQL works well and I will finish the schema Friday.", created_at: "2026-01-01T10:02:00Z" },
    { id: 3, conversation_id: 7, sender_id: 1, sender_name: "Ada", content: "The authentication API is now working.", created_at: "2026-01-01T10:05:00Z" }
];

test("embeddings have cosine self-similarity", () => assert.ok(cosine(embed("database plan"), embed("database plan")) > 0.999));
test("graph includes directed speaker, temporal, and semantic relationships", () => {
    const graph = buildGraph(preprocess(messages));
    assert.ok(graph.edges.length > 0); assert.ok(graph.matrix[0][1] > 0); assert.equal(graph.matrix[1][0], 0);
});
test("weighted personalized PageRank produces a score per message", () => {
    const graph = buildGraph(preprocess(messages)); const rank = personalizedPageRank(graph.matrix, [1, 0.5, 0.2]);
    assert.equal(rank.length, messages.length); assert.ok(rank.every(value => value >= 0));
});
test("MMR selects unique chronological source messages", () => {
    const nodes = preprocess(messages); const selected = selectMmr(nodes, [0.9, 0.7, 0.8], [0, 0, 1], 2, 0.72);
    assert.equal(selected.length, 2); assert.deepEqual([...selected].sort((a, b) => a - b), selected);
});
test("extractive summary retains original source message IDs", () => {
    const result = summarize(messages); assert.ok(result.items.length); assert.ok(result.items.every(item => messages.some(message => message.id === item.messageId)));
});
test("low-information greetings remain graph nodes but are not selected", () => {
    const result = summarize([...messages, { id: 4, conversation_id: 7, sender_id: 2, sender_name: "Lin", content: "hi", created_at: "2026-01-01T10:06:00Z" }]);
    assert.ok(!result.items.some(item => item.text === "hi"));
});
test("Gemini payload contains only graph-selected messages", () => {
    const selected = summarize(messages).items; const payload = selectedMessagePayload(selected);
    assert.deepEqual(payload.map(item => item.message_id), selected.map(item => item.messageId));
});
test("Gemini request receives selected graph evidence only", async () => {
    const selected = summarize(messages).items.slice(0, 2); let request;
    const client = { models: { generateContent: async input => { request = input; return { text: JSON.stringify({ overview: "Two updates", key_topics: [], decisions: [], action_items: [], deadlines: [], open_questions: [], important_points: [{ text: selected[0].text, source_message_ids: [selected[0].messageId] }] }) }; } } };
    await generateStructuredSummary(selected, { client, model: "test-model" });
    const evidence = JSON.parse(request.contents.split("\n").slice(1).join("\n"));
    assert.deepEqual(evidence.map(item => item.message_id), selected.map(item => item.messageId));
    assert.equal(request.config.systemInstruction.includes("graph-based"), true);
});
test("hallucinated Gemini source IDs are rejected", () => {
    const selected = summarize(messages).items;
    const checked = validateStructuredSummary({ overview: "x", key_topics: [], decisions: [], action_items: [], deadlines: [], open_questions: [], important_points: [{ text: "bad", source_message_ids: [999] }] }, selected);
    assert.equal(checked.important_points.length, 0);
    assert.equal(extractiveFallback(selected).important_points.length, selected.length);
});
test("Gemini API errors are logged without raw JSON", () => {
    assert.equal(describeGeminiError(new Error('{"error":{"message":"Invalid key"}}')), "Invalid key");
});
