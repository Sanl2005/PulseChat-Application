"use strict";

/**
 * Extractive graph summarizer.  Selection is entirely deterministic and does
 * not require an LLM: a verbalizer may only be layered over its result.
 * Semantic vectors are hashed token vectors by default, a dependency-free
 * cache-friendly fallback. Set EMBEDDING_PROVIDER=minilm after wiring a local
 * MiniLM service; the graph contract stays exactly the same.
 */
const GRAPH_CONFIG = Object.freeze({
    speakerWeight: 0.35,
    semanticWeight: 0.45,
    temporalWeight: 0.15,
    referenceWeight: 0.85,
    semanticThreshold: 0.16,
    temporalLambda: 0.00008,
    semanticWindow: 80,
    damping: 0.85,
    clusterCount: null,
    maxSummaryMessages: 6,
    importance: { pagerank: 0.42, core: 0.25, recency: 0.13, reference: 0.12, relevance: 0.08 },
    mmrLambda: 0.72
});

const STOP_WORDS = new Set("a an and are as at be by for from has have i in is it of on or that the this to was we with you your".split(" "));
const normalizeText = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const tokens = (text) => normalizeText(text).split(" ").filter(token => token.length > 1 && !STOP_WORDS.has(token));
const LOW_INFORMATION = new Set(["hi", "hello", "hey", "ok", "okay", "nice", "thanks", "thank you", "lol", "yes", "no", "cool"]);
const isLowInformation = (text) => LOW_INFORMATION.has(normalizeText(text));
const hash = (value) => { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

function embed(text, dimensions = 192) {
    const vector = Array(dimensions).fill(0);
    for (const token of tokens(text)) vector[hash(token) % dimensions] += 1;
    const magnitude = Math.hypot(...vector) || 1;
    return vector.map(value => value / magnitude);
}
function cosine(a, b) { return a.reduce((total, value, index) => total + value * b[index], 0); }
function minMax(values) { const min = Math.min(...values), max = Math.max(...values); return values.map(value => max === min ? 1 : (value - min) / (max - min)); }

function preprocess(messages) {
    return messages.filter(message => normalizeText(message.content)).map(message => ({
        messageId: Number(message.id), conversationId: Number(message.conversation_id), senderId: Number(message.sender_id),
        senderName: message.sender_name, timestamp: new Date(message.created_at), text: String(message.content),
        normalizedText: normalizeText(message.content), replyToMessageId: message.reply_to_message_id ? Number(message.reply_to_message_id) : null,
        mentionedUserIds: Array.isArray(message.mentioned_user_ids) ? message.mentioned_user_ids : [], embedding: embed(message.content)
    }));
}

/** Directed W: i -> j. Spectral clustering uses (W + Wᵀ)/2 explicitly because
 * the normalized Laplacian is symmetric; PageRank retains the original W. */
function buildGraph(nodes, config = GRAPH_CONFIG) {
    const edges = [], matrix = Array.from({ length: nodes.length }, () => Array(nodes.length).fill(0));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length && j <= i + config.semanticWindow; j++) {
        const source = nodes[i], target = nodes[j];
        const seconds = Math.max(0, (target.timestamp - source.timestamp) / 1000);
        const relations = { speaker: source.senderId !== target.senderId ? 1 : 0, semantic: cosine(source.embedding, target.embedding), temporal: Math.exp(-config.temporalLambda * seconds), reference: target.replyToMessageId === source.messageId ? 1 : 0 };
        if (relations.semantic < config.semanticThreshold) relations.semantic = 0;
        const weight = config.speakerWeight * relations.speaker + config.semanticWeight * relations.semantic + config.temporalWeight * relations.temporal + config.referenceWeight * relations.reference;
        if (weight > 0) { matrix[i][j] = weight; edges.push({ source: i, target: j, weight, relations }); }
    }
    return { matrix, edges };
}

function spectralClusters(matrix, requestedClusters) {
    const count = matrix.length; if (count < 3) return Array(count).fill(0);
    const k = Math.max(2, Math.min(requestedClusters || Math.round(Math.sqrt(count)), Math.min(6, count)));
    const symmetric = matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2));
    const degree = symmetric.map(row => row.reduce((sum, value) => sum + value, 0) || 1);
    // Two-hop normalized adjacency features approximate the low-frequency
    // Laplacian eigenspace without a heavyweight dense eigenvalue dependency.
    let features = symmetric.map((row, i) => row.map((value, j) => value / Math.sqrt(degree[i] * degree[j])));
    features = features.map((row, i) => row.map((_, j) => row.reduce((sum, value, l) => sum + value * features[l][j], 0)));
    const centroids = features.slice(0, k).map(row => [...row]); let labels = Array(count).fill(0);
    for (let iteration = 0; iteration < 12; iteration++) {
        labels = features.map(row => centroids.reduce((best, centroid, cluster) => { const distance = row.reduce((sum, value, i) => sum + (value - centroid[i]) ** 2, 0); return distance < best.distance ? { cluster, distance } : best; }, { cluster: 0, distance: Infinity }).cluster);
        for (let cluster = 0; cluster < k; cluster++) { const members = features.filter((_, i) => labels[i] === cluster); if (members.length) centroids[cluster] = centroids[cluster].map((_, col) => members.reduce((sum, row) => sum + row[col], 0) / members.length); }
    }
    return labels;
}

function personalizedPageRank(matrix, core) {
    const n = matrix.length; if (!n) return []; const personalization = minMax(core); const total = personalization.reduce((a, b) => a + b, 0); let score = personalization.map(value => value / total);
    for (let turn = 0; turn < 60; turn++) { const next = personalization.map(value => (1 - GRAPH_CONFIG.damping) * value / total); for (let i = 0; i < n; i++) { const out = matrix[i].reduce((a, b) => a + b, 0); if (out) for (let j = 0; j < n; j++) next[j] += GRAPH_CONFIG.damping * score[i] * matrix[i][j] / out; } score = next; }
    return score;
}

function selectMmr(nodes, scores, clusters, maximum, lambda) {
    const selected = [], candidates = [...scores.keys()].filter(index => !isLowInformation(nodes[index].text));
    // Keep the graph complete, but only fall back to low-information nodes if
    // the conversation contains no meaningful utterances at all.
    if (!candidates.length) candidates.push(...scores.keys());
    while (selected.length < Math.min(maximum, nodes.length) && candidates.length) {
        let best = candidates[0], bestScore = -Infinity;
        for (const index of candidates) { const redundancy = selected.length ? Math.max(...selected.map(picked => cosine(nodes[index].embedding, nodes[picked].embedding))) : 0; const represented = selected.some(picked => clusters[picked] === clusters[index]) ? 0 : 0.08; const value = lambda * scores[index] - (1 - lambda) * redundancy + represented; if (value > bestScore) { best = index; bestScore = value; } }
        selected.push(best); candidates.splice(candidates.indexOf(best), 1);
    }
    return selected.sort((a, b) => a - b);
}

function summarize(rawMessages, options = {}) {
    const config = { ...GRAPH_CONFIG, ...options, importance: { ...GRAPH_CONFIG.importance, ...(options.importance || {}) } }; const started = Date.now(); const nodes = preprocess(rawMessages);
    if (!nodes.length) return { algorithmVersion: "graph-v1", summaryText: "No messages to summarize.", items: [], topics: [], stats: { nodes: 0, edges: 0, clusters: 0, processingTimeMs: Date.now() - started } };
    const { matrix, edges } = buildGraph(nodes, config); const clusters = spectralClusters(matrix, config.clusterCount);
    const weightedDegree = matrix.map((row, i) => row.reduce((sum, value) => sum + value, 0) + matrix.reduce((sum, other) => sum + other[i], 0));
    const core = minMax(weightedDegree.map((value, i) => value * (1 + matrix[i].reduce((sum, edge, j) => sum + (clusters[i] === clusters[j] ? edge : 0), 0))));
    const pagerank = minMax(personalizedPageRank(matrix, core)); const reference = minMax(nodes.map(node => node.replyToMessageId ? 1 : 0)); const recency = minMax(nodes.map((_, index) => index)); const relevance = minMax(nodes.map(node => node.embedding.reduce((sum, value) => sum + value, 0)));
    const importance = nodes.map((_, i) => config.importance.pagerank * pagerank[i] + config.importance.core * core[i] + config.importance.recency * recency[i] + config.importance.reference * reference[i] + config.importance.relevance * relevance[i]);
    const selected = selectMmr(nodes, importance, clusters, config.maxSummaryMessages, config.mmrLambda);
    const items = selected.map((index, selectionRank) => ({ messageId: nodes[index].messageId, text: nodes[index].text, senderName: nodes[index].senderName, createdAt: nodes[index].timestamp, importanceScore: importance[index], pagerankScore: pagerank[index], coreScore: core[index], clusterId: clusters[index], selectionRank: selectionRank + 1 }));
    const topics = [...new Set(clusters)].map(clusterId => ({ clusterId, topicLabel: `Topic ${clusterId + 1}`, messageIds: nodes.filter((_, i) => clusters[i] === clusterId).map(node => node.messageId) }));
    return { algorithmVersion: "graph-v1", summaryText: items.map(item => item.text).join("\n"), items, topics, stats: { nodes: nodes.length, edges: edges.length, clusters: new Set(clusters).size, processingTimeMs: Date.now() - started }, graph: { edges, clusters } };
}

module.exports = { GRAPH_CONFIG, normalizeText, isLowInformation, embed, cosine, preprocess, buildGraph, spectralClusters, personalizedPageRank, selectMmr, summarize };
