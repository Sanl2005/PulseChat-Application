"use strict";

const { GoogleGenAI } = require("@google/genai");

// Gemini API may retire previous model aliases; keep the current fast, low-cost
// summarization model in one configurable location.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const SYSTEM_INSTRUCTION = `You are a conversation summarization assistant for PulseChat. You receive ONLY messages selected by a graph-based importance-ranking system. The graph has already determined importance; do not rank or introduce other messages. Organize supplied evidence accurately and concisely. Never invent facts, speakers, dates, deadlines, decisions, or certainty. Preserve assignments, commitments, questions, status, and uncertainty. Ignore greetings or filler unless meaningful. Every generated item must include one or more source_message_ids taken from the supplied messages. Return empty arrays when evidence is insufficient.`;

const sourceIdsSchema = { type: "array", items: { type: "integer" }, minItems: 1 };
const evidenceItem = { type: "object", properties: { text: { type: "string" }, source_message_ids: sourceIdsSchema }, required: ["text", "source_message_ids"] };
const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        overview: { type: "string" },
        key_topics: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, summary: { type: "string" }, source_message_ids: sourceIdsSchema }, required: ["topic", "summary", "source_message_ids"] } },
        decisions: { type: "array", items: evidenceItem },
        action_items: { type: "array", items: { type: "object", properties: { person: { type: "string" }, task: { type: "string" }, deadline: { type: ["string", "null"] }, source_message_ids: sourceIdsSchema }, required: ["person", "task", "deadline", "source_message_ids"] } },
        deadlines: { type: "array", items: { type: "object", properties: { text: { type: "string" }, date: { type: ["string", "null"] }, source_message_ids: sourceIdsSchema }, required: ["text", "date", "source_message_ids"] } },
        open_questions: { type: "array", items: evidenceItem },
        important_points: { type: "array", items: evidenceItem }
    },
    required: ["overview", "key_topics", "decisions", "action_items", "deadlines", "open_questions", "important_points"]
};

function selectedMessagePayload(items) {
    return items.map(item => ({ message_id: item.messageId, sender: item.senderName, timestamp: new Date(item.createdAt).toISOString(), text: item.text, cluster_id: item.clusterId, importance_score: Number(item.importanceScore.toFixed(4)) }));
}

function validateStructuredSummary(candidate, selectedItems) {
    const validIds = new Set(selectedItems.map(item => Number(item.messageId)));
    const validSources = value => Array.isArray(value) && value.length > 0 && value.every(id => validIds.has(Number(id)));
    const cleanEvidence = (items, fields) => (Array.isArray(items) ? items : []).filter(item => item && validSources(item.source_message_ids) && fields.every(field => typeof item[field] === "string")).map(item => ({ ...item, source_message_ids: item.source_message_ids.map(Number) }));
    return {
        overview: typeof candidate?.overview === "string" ? candidate.overview.trim() : "",
        key_topics: cleanEvidence(candidate?.key_topics, ["topic", "summary"]),
        decisions: cleanEvidence(candidate?.decisions, ["text"]),
        action_items: cleanEvidence(candidate?.action_items, ["person", "task"]),
        deadlines: cleanEvidence(candidate?.deadlines, ["text"]),
        open_questions: cleanEvidence(candidate?.open_questions, ["text"]),
        important_points: cleanEvidence(candidate?.important_points, ["text"])
    };
}

function extractResponseText(response) { return response.text || response.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || ""; }

function describeGeminiError(error) {
    try {
        const payload = JSON.parse(error.message);
        return payload?.error?.message || error.message;
    } catch {
        return error.message || "Unknown Gemini error";
    }
}

async function generateStructuredSummary(selectedItems, { client, model = process.env.GEMINI_MODEL || DEFAULT_MODEL } = {}) {
    if (!process.env.GEMINI_API_KEY && !client) throw new Error("GEMINI_API_KEY is not configured");
    const ai = client || new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const evidence = selectedMessagePayload(selectedItems);
    const response = await ai.models.generateContent({
        model,
        contents: `Selected graph evidence (JSON):\n${JSON.stringify(evidence)}`,
        config: { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: "application/json", responseJsonSchema: SUMMARY_SCHEMA, temperature: 0.1 }
    });
    const structured = validateStructuredSummary(JSON.parse(extractResponseText(response)), selectedItems);
    return { summary: structured, model, evidence };
}

function extractiveFallback(items) {
    return {
        overview: items.length ? "Important messages selected by PulseChat's conversation graph." : "No meaningful messages were available to summarize.",
        key_topics: [], decisions: [], action_items: [], deadlines: [], open_questions: [],
        important_points: items.map(item => ({ text: item.text, source_message_ids: [item.messageId] }))
    };
}

module.exports = { DEFAULT_MODEL, selectedMessagePayload, validateStructuredSummary, generateStructuredSummary, extractiveFallback, describeGeminiError };
