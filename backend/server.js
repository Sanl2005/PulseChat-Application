const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { Server } = require("socket.io");

dotenv.config();

const app = express();

const server = http.createServer(app);

app.use(cors());
app.use(express.json());

/* =====================================================
   PostgreSQL
===================================================== */

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});


pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL error:", error);
});


/* =====================================================
   Socket.IO
===================================================== */

const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

/* =====================================================
   AUTHENTICATION
===================================================== */

function authenticateToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Authentication token is required"
        });
    }

    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not configured");
        return res.status(500).json({
            error: "Server authentication is not configured"
        });
    }

    const token = authorization.slice("Bearer ".length);

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({
            error: "Invalid or expired authentication token"
        });
    }
}

app.post("/api/auth/register", async (req, res) => {

    const {
        username,
        displayName,
        phoneNumber,
        password
    } = req.body;

    if (
        !username ||
        !displayName ||
        !phoneNumber ||
        !password
    ) {
        return res.status(400).json({
            error: "All fields are required"
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            error:
                "Password must contain at least 8 characters"
        });
    }

    try {

        const normalizedUsername = username.trim();

        if (normalizedUsername.length < 3 || normalizedUsername.length > 100) {
            return res.status(400).json({
                error: "Username must be between 3 and 100 characters"
            });
        }

        /*
         * Remove spaces, -, (, )
         */

        const normalizedPhone =
            phoneNumber
                .replace(/[\s()-]/g, "");

        /*
         * Basic international format.
         *
         * Example:
         * +919876543210
         */

        if (
            !/^\+[1-9]\d{7,14}$/
                .test(normalizedPhone)
        ) {

            return res.status(400).json({
                error:
                    "Enter phone number with country code"
            });

        }

        /*
         * Check whether number already exists
         */

        const existing =
            await pool.query(
                `
                SELECT id, username, phone_number
                FROM users
                WHERE username = $1 OR phone_number = $2
                `,
                [normalizedUsername, normalizedPhone]
            );

        if (existing.rows.length > 0) {

            return res.status(409).json({
                error: existing.rows[0].username === normalizedUsername
                    ? "Username is already taken"
                    : "Phone number is already registered"
            });

        }

        /*
         * Hash password
         */

        const passwordHash =
            await bcrypt.hash(
                password,
                12
            );

        /*
         * Create user
         */

        const result =
            await pool.query(
                `
                INSERT INTO users
                (
                    username,
                    phone_number,
                    password_hash,
                    display_name,
                    phone_verified
                )
                VALUES
                ($1, $2, $3, $4, FALSE)
                RETURNING
                    id,
                    username,
                    phone_number,
                    display_name,
                    phone_verified,
                    created_at
                `,
                [
                    normalizedUsername,
                    normalizedPhone,
                    passwordHash,
                    displayName
                ]
            );

        res.status(201).json({
            message:
                "Registration successful",
            user: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error:
                "Registration failed"
        });

    }

});

app.post("/api/auth/login", async (req, res) => {

    const {
        identifier,
        username,
        phoneNumber,
        password
    } = req.body;

    if (
        !(identifier || username || phoneNumber) ||
        !password
    ) {

        return res.status(400).json({
            error:
                "Username or phone number and password are required"
        });

    }

    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not configured");
        return res.status(500).json({
            error: "Server authentication is not configured"
        });
    }

    try {

        const loginIdentifier = String(
            identifier || username || phoneNumber
        ).trim();

        const normalizedPhone =
            loginIdentifier
                .replace(/[\s()-]/g, "");

        const result =
            await pool.query(
                `
                SELECT
                    id,
                    username,
                    phone_number,
                    password_hash,
                    display_name,
                    phone_verified
                FROM users
                WHERE username = $1 OR phone_number = $2
                `,
                [loginIdentifier, normalizedPhone]
            );

        if (
            result.rows.length === 0
        ) {

            return res.status(401).json({
                error:
                    "Invalid username, phone number or password"
            });

        }

        const user =
            result.rows[0];

        if (!user.password_hash) {
            return res.status(401).json({
                error: "Invalid username, phone number or password"
            });
        }

        const passwordValid =
            await bcrypt.compare(
                password,
                user.password_hash
            );

        if (!passwordValid) {

            return res.status(401).json({
                error:
                    "Invalid username, phone number or password"
            });

        }

        const token =
            jwt.sign(
                {
                    userId: user.id
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "7d"
                }
            );

        delete user.password_hash;

        res.json({

            message:
                "Login successful",

            token,

            user

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error:
                "Login failed"
        });

    }

});


/* =====================================================
   TEST ROUTE
===================================================== */

app.get("/", (req, res) => {

    res.json({
        message: "PulseChat backend is running"
    });

});


/* =====================================================
   USERS
===================================================== */

app.get("/api/users", async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                id,
                username,
                display_name
            FROM users
            ORDER BY username
            `
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch users"
        });

    }

});

/*user_search*/
app.get(
    "/api/users/search",
    authenticateToken,
    async (req, res) => {

        const searchQuery =
            typeof req.query.query === "string"
                ? req.query.query.trim()
                : "";

        if (!searchQuery) {

            return res.status(400).json({
                error: "Search query is required"
            });

        }

        const normalizedPhone = searchQuery.replace(/\D/g, "");

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        display_name,
                        phone_number
                    FROM users
                    WHERE id <> $1
                    AND (
                        username ILIKE $2
                        OR COALESCE(display_name, '') ILIKE $2
                        OR (
                            LENGTH($3) >= 5
                            AND REGEXP_REPLACE(phone_number, '\\D', '', 'g') LIKE '%' || $3
                        )
                    )
                    ORDER BY
                        COALESCE(NULLIF(TRIM(display_name), ''), username),
                        id
                    LIMIT 20
                    `,
                    [
                        req.user.userId,
                        `%${searchQuery}%`,
                        normalizedPhone
                    ]
                );

            res.json(
                result.rows
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Search failed"
            });

        }

    }
);


/* =====================================================
   GET USER CONVERSATIONS
===================================================== */

app.get(
    "/api/conversations/:userId",
    async (req, res) => {

        const { userId } = req.params;

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        c.id,
                        c.name,
                        c.is_group,
                        c.created_by,
                        c.created_at,

                        CASE
                            WHEN c.is_group = TRUE
                                THEN c.name

                            ELSE other_user.display_name
                        END AS display_name

                    FROM conversations c

                    INNER JOIN conversation_members cm
                        ON c.id =
                           cm.conversation_id

                    LEFT JOIN LATERAL (
                        SELECT
                            COALESCE(
                                NULLIF(TRIM(u.display_name), ''),
                                u.username
                            ) AS display_name
                        FROM conversation_members cm2
                        INNER JOIN users u
                            ON cm2.user_id = u.id
                        WHERE cm2.conversation_id =
                              c.id
                        AND cm2.user_id <>
                            $1
                        LIMIT 1
                    ) other_user
                        ON c.is_group = FALSE

                    WHERE cm.user_id = $1

                    ORDER BY
                        c.created_at DESC
                    `,
                    [userId]
                );

            res.json(result.rows);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Failed to fetch conversations"
            });

        }

    }
);


/* =====================================================
   GET CONVERSATION MEMBERS
===================================================== */

app.get(
    "/api/conversations/:conversationId/members",
    async (req, res) => {

        const { conversationId } = req.params;

        try {

            const result = await pool.query(
                `
                SELECT
                    u.id,
                    u.username,
                    COALESCE(
                        NULLIF(TRIM(u.display_name), ''),
                        u.username
                    ) AS display_name,
                    cm.role
                FROM conversation_members cm
                INNER JOIN users u
                    ON cm.user_id = u.id
                WHERE cm.conversation_id = $1
                ORDER BY u.username
                `,
                [conversationId]
            );

            res.json(result.rows);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Failed to fetch members"
            });

        }

    }
);


/* =====================================================
   GET MESSAGES
===================================================== */

app.get(
    "/api/messages/:conversationId",
    async (req, res) => {

        const { conversationId } = req.params;

        try {

            const result = await pool.query(
                `
                SELECT
                    m.id,
                    m.content,
                    m.sender_id,
                    COALESCE(
                        NULLIF(TRIM(u.display_name), ''),
                        u.username
                    ) AS sender_name,
                    m.is_read,
                    m.priority,
                    m.created_at
                FROM messages m
                INNER JOIN users u
                    ON m.sender_id = u.id
                WHERE m.conversation_id = $1
                ORDER BY m.created_at ASC
                `,
                [conversationId]
            );

            res.json(result.rows);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Failed to fetch messages"
            });

        }

    }
);


/* =====================================================
   CREATE OR GET DIRECT CONVERSATION
===================================================== */

app.post(
    "/api/conversations/direct",
    async (req, res) => {

        const {
            userId,
            otherUserId
        } = req.body;

        if (!userId || !otherUserId) {

            return res.status(400).json({
                error: "Both users are required"
            });

        }

        if (
            Number(userId) ===
            Number(otherUserId)
        ) {

            return res.status(400).json({
                error: "You cannot chat with yourself"
            });

        }

        try {

            /*
             * Always store the smaller user ID first.
             */

            const user1 = Math.min(
                Number(userId),
                Number(otherUserId)
            );

            const user2 = Math.max(
                Number(userId),
                Number(otherUserId)
            );


            /*
             * Check existing direct conversation.
             */

            const existing =
                await pool.query(
                    `
                    SELECT
                        c.id,
                        c.name,
                        c.is_group,
                        c.created_at
                    FROM conversations c
                    WHERE c.is_group = FALSE
                    AND c.direct_user1_id = $1
                    AND c.direct_user2_id = $2
                    LIMIT 1
                    `,
                    [
                        user1,
                        user2
                    ]
                );


            /*
             * Already exists.
             */

            if (existing.rows.length > 0) {

                return res.json({
                    conversation:
                        existing.rows[0],
                    existing: true
                });

            }


            /*
             * Create new direct conversation.
             */

            const conversation =
                await pool.query(
                    `
                    INSERT INTO conversations
                    (
                        name,
                        is_group,
                        created_by,
                        direct_user1_id,
                        direct_user2_id
                    )
                    VALUES
                    (
                        NULL,
                        FALSE,
                        $1,
                        $2,
                        $3
                    )
                    RETURNING
                        id,
                        name,
                        is_group,
                        created_by,
                        direct_user1_id,
                        direct_user2_id,
                        created_at
                    `,
                    [
                        userId,
                        user1,
                        user2
                    ]
                );


            const newConversation =
                conversation.rows[0];


            /*
             * Add both users.
             */

            await pool.query(
                `
                INSERT INTO conversation_members
                (
                    conversation_id,
                    user_id,
                    role
                )
                VALUES
                    ($1, $2, 'member'),
                    ($1, $3, 'member')
                `,
                [
                    newConversation.id,
                    user1,
                    user2
                ]
            );


            /*
             * Return conversation.
             */

            res.status(201).json({
                conversation:
                    newConversation,
                existing: false
            });


        } catch (error) {

            /*
             * Unique constraint protection.
             * This can happen if two users create
             * the same chat simultaneously.
             */

            if (
                error.code === "23505"
            ) {

                const existing =
                    await pool.query(
                        `
                        SELECT
                            id,
                            name,
                            is_group,
                            created_at
                        FROM conversations
                        WHERE is_group = FALSE
                        AND direct_user1_id = $1
                        AND direct_user2_id = $2
                        LIMIT 1
                        `,
                        [
                            Math.min(
                                Number(userId),
                                Number(otherUserId)
                            ),
                            Math.max(
                                Number(userId),
                                Number(otherUserId)
                            )
                        ]
                    );

                if (
                    existing.rows.length > 0
                ) {

                    return res.json({
                        conversation:
                            existing.rows[0],
                        existing: true
                    });

                }

            }

            console.error(error);

            res.status(500).json({
                error:
                    "Failed to create direct conversation"
            });

        }

    }
);

/* =====================================================
   CREATE GROUP
===================================================== */

app.post(
    "/api/conversations/group",
    async (req, res) => {

        const {
            name,
            creatorId,
            memberIds
        } = req.body;

        if (
            !name ||
            !creatorId ||
            !Array.isArray(memberIds)
        ) {

            return res.status(400).json({
                error: "Group name, creator and members are required"
            });

        }

        try {

            /*
             * Ensure creator is included
             */

            const members = [
                creatorId,
                ...memberIds
            ];

            /*
             * Remove duplicate IDs
             */

            const uniqueMembers = [
                ...new Set(
                    members.map(Number)
                )
            ];

            /*
             * Group needs at least 2 members
             */

            if (uniqueMembers.length < 2) {

                return res.status(400).json({
                    error: "A group needs at least two members"
                });

            }

            /*
             * Create conversation
             */

            const conversationResult =
                await pool.query(
                    `
                    INSERT INTO conversations
                    (
                        name,
                        is_group,
                        created_by
                    )
                    VALUES
                    (
                        $1,
                        TRUE,
                        $2
                    )
                    RETURNING id, name, is_group
                    `,
                    [
                        name.trim(),
                        creatorId
                    ]
                );

            const conversation =
                conversationResult.rows[0];

            /*
             * Add members
             */

            for (const memberId of uniqueMembers) {

                await pool.query(
                    `
                    INSERT INTO conversation_members
                    (
                        conversation_id,
                        user_id,
                        role
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3
                    )
                    `,
                    [
                        conversation.id,
                        memberId,
                        Number(memberId) ===
                        Number(creatorId)
                            ? "admin"
                            : "member"
                    ]
                );

            }

            res.status(201).json({
                message: "Group created successfully",
                conversation
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: "Failed to create group"
            });

        }

    }
);

/* =====================================================
   PHASE 2: GRAPH-BASED CONVERSATION SUMMARIES
   Apply migrations before using these routes.
===================================================== */

const { summarize } = require("./summarization/graphSummarizer");
const { generateStructuredSummary, extractiveFallback, describeGeminiError } = require("./summarization/geminiService");

async function requireConversationMember(conversationId, userId) {
    const membership = await pool.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId]
    );
    return membership.rows.length > 0;
}

async function getConversationMessages(conversationId) {
    const result = await pool.query(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
                COALESCE(NULLIF(TRIM(u.display_name), ''), u.username) AS sender_name
         FROM messages m INNER JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
        [conversationId]
    );
    return result.rows;
}

app.post("/api/conversations/:conversationId/summarize", authenticateToken, async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId) || !await requireConversationMember(conversationId, req.user.userId)) {
        return res.status(404).json({ error: "Conversation not found" });
    }
    try {
        const messages = await getConversationMessages(conversationId);
        const result = summarize(messages, { maxSummaryMessages: Number(req.body.maxMessages) || undefined });
        const totalStarted = Date.now();
        let structuredSummary = extractiveFallback(result.items);
        let summaryMode = "extractive_fallback";
        let modelName = null;
        let geminiProcessingTimeMs = null;
        try {
            const geminiStarted = Date.now();
            const gemini = await generateStructuredSummary(result.items);
            structuredSummary = gemini.summary;
            summaryMode = "gemini";
            modelName = gemini.model;
            geminiProcessingTimeMs = Date.now() - geminiStarted;
        } catch (geminiError) {
            // A failed verbalization never compromises the graph-derived summary.
            console.warn("Gemini summary fallback", { conversationId, reason: describeGeminiError(geminiError) });
        }
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const stored = await client.query(
                `INSERT INTO conversation_summaries
                    (conversation_id, summary, summary_text, summary_type, message_start_id, message_end_id, algorithm_version, processing_time_ms, message_count, last_summarized_message_id, summary_mode, model_name, structured_summary)
                 VALUES ($1, $2, $2, 'graph_extractive', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [conversationId, structuredSummary.overview || result.summaryText, result.items[0]?.messageId || null, result.items.at(-1)?.messageId || null,
                    result.algorithmVersion, Date.now() - totalStarted, messages.length, messages.at(-1)?.id || null,
                    summaryMode, modelName, JSON.stringify(structuredSummary)]
            );
            const summary = stored.rows[0];
            for (const item of result.items) {
                await client.query(
                    `INSERT INTO summary_messages (summary_id, message_id, importance_score, pagerank_score, core_score, cluster_id, selection_rank)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [summary.id, item.messageId, item.importanceScore, item.pagerankScore, item.coreScore, item.clusterId, item.selectionRank]
                );
            }
            for (const topic of result.topics) {
                await client.query(
                    `INSERT INTO conversation_topics (conversation_id, cluster_id, topic_label, topic_summary)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (conversation_id, cluster_id) DO UPDATE SET topic_label = EXCLUDED.topic_label, topic_summary = EXCLUDED.topic_summary, created_at = NOW()`,
                    [conversationId, topic.clusterId, topic.topicLabel, null]
                );
            }
            await client.query("COMMIT");
            console.info("Summary generated", { conversationId, numberOfMessages: messages.length, ...result.stats, selectedMessageCount: result.items.length, geminiProcessingTimeMs, totalProcessingTimeMs: Date.now() - totalStarted, geminiModel: modelName, summaryMode });
            return res.status(201).json({
                conversationId,
                graph: { ...result.stats, selectedMessageCount: result.items.length, algorithmVersion: result.algorithmVersion },
                summary: { ...structuredSummary, mode: summaryMode, model: modelName, generated_at: summary.generated_at },
                items: result.items,
                topics: structuredSummary.key_topics.length ? structuredSummary.key_topics : result.topics
            });
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    } catch (error) {
        console.error("Summarization error:", error.message);
        return res.status(500).json({ error: "Failed to generate summary. Ensure the Phase 2 migration has been applied." });
    }
});

app.get("/api/conversations/:conversationId/summary", authenticateToken, async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId) || !await requireConversationMember(conversationId, req.user.userId)) return res.status(404).json({ error: "Conversation not found" });
    try {
        const result = await pool.query("SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY generated_at DESC LIMIT 1", [conversationId]);
        return res.json({ summary: result.rows[0] || null });
    } catch (error) { return res.status(500).json({ error: "Failed to load summary" }); }
});

app.get("/api/conversations/:conversationId/summary/details", authenticateToken, async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId) || !await requireConversationMember(conversationId, req.user.userId)) return res.status(404).json({ error: "Conversation not found" });
    try {
        const summaryResult = await pool.query("SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY generated_at DESC LIMIT 1", [conversationId]);
        const summary = summaryResult.rows[0]; if (!summary) return res.json({ summary: null, items: [], topics: [] });
        const [items, topics] = await Promise.all([
            pool.query(`SELECT sm.*, m.content AS text, m.created_at, COALESCE(NULLIF(TRIM(u.display_name), ''), u.username) AS sender_name
                        FROM summary_messages sm INNER JOIN messages m ON m.id = sm.message_id INNER JOIN users u ON u.id = m.sender_id
                        WHERE sm.summary_id = $1 ORDER BY sm.selection_rank`, [summary.id]),
            pool.query("SELECT * FROM conversation_topics WHERE conversation_id = $1 ORDER BY cluster_id", [conversationId])
        ]);
        return res.json({ summary, items: items.rows, topics: topics.rows });
    } catch (error) { return res.status(500).json({ error: "Failed to load summary details" }); }
});

app.get("/api/messages/:messageId/importance", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sm.* FROM summary_messages sm INNER JOIN conversation_summaries cs ON cs.id = sm.summary_id
             INNER JOIN conversation_members cm ON cm.conversation_id = cs.conversation_id
             WHERE sm.message_id = $1 AND cm.user_id = $2 ORDER BY cs.generated_at DESC LIMIT 1`,
            [Number(req.params.messageId), req.user.userId]
        );
        return res.json({ importance: result.rows[0] || null });
    } catch (error) { return res.status(500).json({ error: "Failed to load importance" }); }
});


/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", (socket) => {

    console.log(
        "User connected:",
        socket.id
    );


    /* -----------------------------------------------
       JOIN CONVERSATION
    ------------------------------------------------ */

    socket.on(
        "join_conversation",
        (conversationId) => {

            socket.join(
                `conversation_${conversationId}`
            );

            console.log(
                `${socket.id} joined conversation ${conversationId}`
            );

        }
    );


    /* -----------------------------------------------
       LEAVE CONVERSATION
    ------------------------------------------------ */

    socket.on(
        "leave_conversation",
        (conversationId) => {

            socket.leave(
                `conversation_${conversationId}`
            );

        }
    );


    /* -----------------------------------------------
       SEND MESSAGE
    ------------------------------------------------ */

    socket.on(
        "send_message",
        async (data) => {

            try {

                const {
                    conversationId,
                    senderId,
                    content
                } = data;

                if (
                    !conversationId ||
                    !senderId ||
                    !content ||
                    !content.trim()
                ) {

                    return;

                }

                /*
                 * Store message
                 */

                const result =
                    await pool.query(
                        `
                        INSERT INTO messages
                        (
                            conversation_id,
                            sender_id,
                            content
                        )
                        VALUES
                        (
                            $1,
                            $2,
                            $3
                        )
                        RETURNING *
                        `,
                        [
                            conversationId,
                            senderId,
                            content.trim()
                        ]
                    );

                const message =
                    result.rows[0];


                /*
                 * Get sender information
                 */

                const senderResult =
                    await pool.query(
                        `
                        SELECT
                            COALESCE(
                                NULLIF(TRIM(display_name), ''),
                                username
                            ) AS display_name
                        FROM users
                        WHERE id = $1
                        `,
                        [senderId]
                    );

                message.sender_name =
                    senderResult.rows[0].display_name;


                /*
                 * Broadcast message
                 * to entire conversation
                 */

                io.to(
                    `conversation_${conversationId}`
                ).emit(
                    "receive_message",
                    message
                );

            } catch (error) {

                console.error(
                    "Message error:",
                    error
                );

            }

        }
    );


    /* -----------------------------------------------
       MARK AS READ
    ------------------------------------------------ */

    socket.on(
        "mark_read",
        async (data) => {

            try {

                const {
                    conversationId,
                    userId
                } = data;

                await pool.query(
                    `
                    UPDATE messages
                    SET is_read = TRUE
                    WHERE conversation_id = $1
                    AND sender_id != $2
                    `,
                    [
                        conversationId,
                        userId
                    ]
                );

            } catch (error) {

                console.error(
                    "Read status error:",
                    error
                );

            }

        }
    );


    /* -----------------------------------------------
       DISCONNECT
    ------------------------------------------------ */

    socket.on(
        "disconnect",
        () => {

            console.log(
                "User disconnected:",
                socket.id
            );

        }
    );

});


/* =====================================================
   START SERVER
===================================================== */

const PORT =
    process.env.PORT || 5000;

server.listen(
    PORT,
    () => {

        console.log(
            `PulseChat backend running on port ${PORT}`
        );

    }
);
