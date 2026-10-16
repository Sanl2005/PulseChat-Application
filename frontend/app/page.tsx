"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useRouter } from "next/navigation";

import "./globals.css";

const socket = io("http://localhost:5000", {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity
});

type User = {
    id: number;
    username: string;
    display_name?: string;
};

type Conversation = {
    id: number;
    name: string | null;
    is_group: boolean;
    display_name?: string;
};

type ChatMessage = {
    id: number;
    conversation_id: number;
    sender_id: number;
    sender_name: string;
    content: string;
    created_at: string;
    is_read?: boolean;
};

type SummaryItem = {
    messageId: number;
    message_id?: number;
    text: string;
    senderName?: string;
    sender_name?: string;
    importanceScore?: number;
    importance_score?: number;
};

type GroundedSummaryItem = {
    text?: string;
    person?: string;
    task?: string;
    deadline?: string | null;
    date?: string | null;
    topic?: string;
    summary?: string;
    source_message_ids: number[];
};

type StructuredSummary = {
    mode?: "gemini" | "extractive_fallback";
    model?: string | null;
    overview: string;
    key_topics: GroundedSummaryItem[];
    decisions: GroundedSummaryItem[];
    action_items: GroundedSummaryItem[];
    deadlines: GroundedSummaryItem[];
    open_questions: GroundedSummaryItem[];
    important_points: GroundedSummaryItem[];
    generated_at?: string;
};

type ConversationSummary = {
    summary: StructuredSummary | null;
    items: SummaryItem[];
    topics: { cluster_id?: number; clusterId?: number; topic_label?: string; topicLabel?: string }[];
    graph?: { nodes: number; edges: number; clusters: number; selectedMessageCount: number; processingTimeMs: number; algorithmVersion: string };
};

export default function Home() {
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [message, setMessage] = useState("");
    const [showGroupForm, setShowGroupForm] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [searchError, setSearchError] = useState("");
    const [summaryData, setSummaryData] = useState<ConversationSummary | null>(null);
    const [showSummary, setShowSummary] = useState(false);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState("");
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
    useEffect(() => {

        const user =
            localStorage.getItem(
                "pulsechat_user"
            );

        if (!user) {

            router.push("/login");

            return;

        }

        try {
            const parsedUser = JSON.parse(user) as User;
            const timer = window.setTimeout(() => {
                setCurrentUser(parsedUser);
            }, 0);

            return () => window.clearTimeout(timer);
        } catch {
            localStorage.removeItem("pulsechat_user");
            localStorage.removeItem("pulsechat_token");
            router.replace("/login");
        }

    }, [router]);
    
    // Step 10: State for New Chat panel
    const [showNewChat, setShowNewChat] = useState(false);

    /* =====================================================
       LOAD USERS
    ===================================================== */
    useEffect(() => {
        fetch("http://localhost:5000/api/users")
            .then(res => res.json())
            .then(data => {
                setUsers(data);
            })
            .catch(error => {
                console.error("User loading error:", error);
            });
    }, []);

    /* Search the database after the user has entered two characters. */
    useEffect(() => {
        const query = searchTerm.trim();
        const token = localStorage.getItem("pulsechat_token");

        if (query.length < 2 || !token) {
            setSearchResults([]);
            setSearchError("");
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            try {
                const response = await fetch(
                    `http://localhost:5000/api/users/search?query=${encodeURIComponent(query)}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                        signal: controller.signal
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Search failed");
                }

                setSearchResults(data);
                setSearchError("");
            } catch (error) {
                if ((error as Error).name !== "AbortError") {
                    setSearchResults([]);
                    setSearchError((error as Error).message || "Search failed");
                }
            }
        }, 250);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [searchTerm]);

    /* =====================================================
       LOAD CONVERSATIONS
    ===================================================== */
    useEffect(() => {
        if (!currentUser) {
            return;
        }

        fetch(`http://localhost:5000/api/conversations/${currentUser.id}`)
            .then(res => res.json())
            .then(data => {
                setConversations(data);
            })
            .catch(error => {
                console.error("Conversation loading error:", error);
            });
    }, [currentUser]);

    /* =====================================================
       LOAD MESSAGES
    ===================================================== */
    useEffect(() => {
        if (!selectedConversation) {
            return;
        }

        const conversationId = selectedConversation.id;

        fetch(`http://localhost:5000/api/messages/${conversationId}`)
            .then(res => res.json())
            .then(data => {
                setMessages(data);
            })
            .catch(error => {
                console.error("Message loading error:", error);
            });

        /* Join Socket.IO room */
        socket.emit("join_conversation", conversationId);

        /* Mark messages read */
        if (currentUser) {
            socket.emit("mark_read", {
                conversationId,
                userId: currentUser.id
            });
        }

        /* BUG FIX: Re-join the room whenever the socket reconnects.
         * Socket.IO rooms are server-side — they are lost on reconnect.
         * Without this, the client stops receiving broadcasts after any
         * network hiccup or dev-server hot-reload. */
        const handleReconnect = () => {
            socket.emit("join_conversation", conversationId);
            if (currentUser) {
                socket.emit("mark_read", {
                    conversationId,
                    userId: currentUser.id
                });
            }
        };

        socket.on("connect", handleReconnect);

        return () => {
            socket.off("connect", handleReconnect);
            /* Only leave if we are switching away — not if the component
             * is unmounting due to a Hot-Module Reload.  We capture the
             * ID at effect-creation time so the cleanup closure always
             * refers to the conversation that was joined here. */
            socket.emit("leave_conversation", conversationId);
        };
    }, [selectedConversation, currentUser]);

    /* =====================================================
       RECEIVE MESSAGE & READ RECEIPTS
    ===================================================== */
    useEffect(() => {
        const handleReceiveMessage = (newMessage: ChatMessage) => {
            if (
                selectedConversation &&
                Number(newMessage.conversation_id) === Number(selectedConversation.id)
            ) {
                setMessages(prev => {
                    // Replace an optimistic message (same sender + content, temp id)
                    const optimisticIdx = prev.findIndex(
                        m => m.id > 1_000_000_000_000 &&
                             Number(m.sender_id) === Number(newMessage.sender_id) &&
                             m.content === newMessage.content
                    );
                    if (optimisticIdx !== -1) {
                        const next = [...prev];
                        next[optimisticIdx] = newMessage;
                        return next;
                    }
                    // Prevent exact duplicate by real id
                    if (prev.some(m => m.id === newMessage.id)) return prev;
                    return [...prev, newMessage];
                });

                if (currentUser && Number(newMessage.sender_id) !== Number(currentUser.id)) {
                    socket.emit("mark_read", {
                        conversationId: selectedConversation.id,
                        userId: currentUser.id
                    });
                }
            }
        };

        const handleMessagesRead = (data: { conversationId: number; readerId: number }) => {
            if (
                selectedConversation &&
                Number(data.conversationId) === Number(selectedConversation.id)
            ) {
                setMessages(prev =>
                    prev.map(msg =>
                        Number(msg.sender_id) !== Number(data.readerId)
                            ? { ...msg, is_read: true }
                            : msg
                    )
                );
            }
        };

        socket.on("receive_message", handleReceiveMessage);
        socket.on("messages_read", handleMessagesRead);

        return () => {
            socket.off("receive_message", handleReceiveMessage);
            socket.off("messages_read", handleMessagesRead);
        };
    }, [selectedConversation, currentUser]);

    /* =====================================================
       Step 11: START DIRECT CHAT FUNCTION
    ===================================================== */
    const startDirectChat = async (otherUserId: number) => {
        if (!currentUser) {
            return;
        }

        try {
            const response = await fetch(
                "http://localhost:5000/api/conversations/direct",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        userId: currentUser.id,
                        otherUserId: otherUserId
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || "Unable to start chat");
                return;
            }

            const conversation = data.conversation;

            /* Add conversation to sidebar if it wasn't already there. */
            setConversations(prev => {
                const exists = prev.some(c => c.id === conversation.id);
                if (exists) {
                    return prev;
                }
                return [conversation, ...prev];
            });

            /* Select conversation */
            setSelectedConversation(conversation);

            /* Close New Chat window */
            setShowNewChat(false);

            /* Reload conversations so display_name is available. */
            const conversationsResponse = await fetch(
                `http://localhost:5000/api/conversations/${currentUser.id}`
            );
            const conversationsData = await conversationsResponse.json();
            setConversations(conversationsData);

            /* Select the newly opened conversation */
            const selected = conversationsData.find((c: Conversation) => c.id === conversation.id);
            if (selected) {
                setSelectedConversation(selected);
            }
        } catch (error) {
            console.error(error);
            alert("Failed to start conversation");
        }
    };

    /* =====================================================
       SEND MESSAGE
    ===================================================== */
    const sendMessage = () => {
        if (!message.trim() || !currentUser || !selectedConversation) {
            return;
        }

        const trimmed = message.trim();

        socket.emit("send_message", {
            conversationId: selectedConversation.id,
            senderId: currentUser.id,
            content: trimmed
        });

        /* BUG FIX: Optimistically add the sender's own message.
         * The backend broadcasts via io.to(room).emit("receive_message"),
         * which includes the sender's socket.  However, if the socket
         * silently reconnected and lost its room membership, the sender
         * would never see their own message.  Adding it locally the
         * moment we send guarantees it always appears, and the duplicate
         * guard in handleReceiveMessage prevents it from appearing twice
         * if the round-trip broadcast does arrive. */
        const optimisticMsg: ChatMessage = {
            id: Date.now(),          // temp id; overwritten by broadcast
            conversation_id: selectedConversation.id,
            sender_id: currentUser.id,
            sender_name: currentUser.display_name || currentUser.username,
            content: trimmed,
            created_at: new Date().toISOString(),
            is_read: false
        };

        setMessages(prev => [...prev, optimisticMsg]);
        setMessage("");
    };

    const generateSummary = async () => {
        if (!selectedConversation) return;
        setSummaryLoading(true);
        setSummaryError("");
        try {
            const token = localStorage.getItem("pulsechat_token");
            const response = await fetch(`http://localhost:5000/api/conversations/${selectedConversation.id}/summarize`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ maxMessages: 6 })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to generate summary");
            setSummaryData(data);
            setShowSummary(true);
        } catch (error) {
            setSummaryError((error as Error).message || "Unable to generate summary");
        } finally {
            setSummaryLoading(false);
        }
    };

    const viewSource = (sourceIds?: number | number[]) => {
        if (!sourceIds) return;
        const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
        const targetId = ids.find(id => typeof id === "number" && !isNaN(id));
        if (!targetId) return;

        const element = document.getElementById(`message-${targetId}`);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlightedMessageId(targetId);
            window.setTimeout(() => {
                setHighlightedMessageId(prev => (prev === targetId ? null : prev));
            }, 3000);
        } else {
            console.warn(`Source message #${targetId} not found in DOM`);
        }
    };

    const sourceButton = (sourceIds?: number[]) => {
        if (!sourceIds || sourceIds.length === 0) return null;
        return (
            <button
                type="button"
                className="view-source-btn"
                onClick={() => viewSource(sourceIds)}
                title={`Jump to source message #${sourceIds[0]}`}
            >
                🔍 View source {sourceIds.length > 1 ? `(#${sourceIds[0]}+)` : `#${sourceIds[0]}`}
            </button>
        );
    };

    /* =====================================================
       ENTER KEY
    ===================================================== */
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            sendMessage();
        }
    };

    /* =====================================================
       SELECT MEMBER
    ===================================================== */
    const toggleMember = (userId: number) => {
        setSelectedMembers(prev => {
            if (prev.includes(userId)) {
                return prev.filter(id => id !== userId);
            }
            return [...prev, userId];
        });
    };

    /* =====================================================
       CREATE GROUP
    ===================================================== */
    const createGroup = async () => {
        if (!groupName.trim() || !currentUser || selectedMembers.length === 0) {
            alert("Enter a group name and select members.");
            return;
        }

        try {
            const response = await fetch(
                "http://localhost:5000/api/conversations/group",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: groupName,
                        creatorId: currentUser.id,
                        memberIds: selectedMembers
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || "Failed to create group");
                return;
            }

            setConversations(prev => [data.conversation, ...prev]);
            setSelectedConversation(data.conversation);
            setGroupName("");
            setSelectedMembers([]);
            setShowGroupForm(false);
        } catch (error) {
            console.error(error);
            alert("Failed to create group");
        }
    };

    /* =====================================================
       Step 12: FORMAT CONVERSATION NAME
    ===================================================== */
    const getConversationName = (conversation: Conversation) => {
        return conversation.display_name || conversation.name || "Chat";
    };

    const logout = () => {
        localStorage.removeItem("pulsechat_token");
        localStorage.removeItem("pulsechat_user");
        socket.disconnect();
        router.replace("/login");
    };

    const peopleToShow = searchResults;
    const getInitials = (name?: string | null) =>
        (name || "PC").split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();

    return (
        <main className="app-container">
            {/* =================================================
                SIDEBAR
            ================================================= */}
            <aside className="sidebar">
                <div className="brand">
                    <div className="brand-lockup"><span className="brand-orb">P</span><div><h1>PulseChat</h1><p>Smart communication</p></div></div>
                </div>

                <div className="profile-section">
                    <div>
                        <span className="profile-label">Signed in as</span>
                        <strong>{currentUser?.display_name || currentUser?.username || "Loading..."}</strong>
                    </div>
                    <button className="logout-button" type="button" onClick={logout}>Log out</button>
                </div>



                {/* Step 13: SIDEBAR BUTTONS */}
                <div className="conversation-header">
                    <span className="section-title">Messages</span>
                    <div className="conversation-actions">
                        <button onClick={() => { setShowNewChat(!showNewChat); setSearchTerm(""); setSearchResults([]); }}>
                            + Chat
                        </button>
                        <button onClick={() => setShowGroupForm(!showGroupForm)}>
                            + Group
                        </button>
                    </div>
                </div>

                {/* Step 14: NEW CHAT POPUP */}
                {showNewChat && (
                    <div className="new-chat-panel">
                        <h3>New Chat</h3>
                        <input
                            className="user-search"
                            type="search"
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            placeholder="Search people or phone number"
                            aria-label="Search global users"
                        />
                        {searchError && <p className="search-error">{searchError}</p>}
                        {searchTerm.trim().length < 2 && <p className="search-hint">Enter at least two characters or complete phone number.</p>}
                        {searchTerm.trim().length >= 2 && peopleToShow
                            .filter(user => user.id !== currentUser?.id)
                            .map(user => (
                                <button
                                    key={user.id}
                                    className="new-chat-user"
                                    onClick={() => startDirectChat(user.id)}
                                >
                                    <span>👤</span>
                                    <span>{user.display_name || user.username}</span>
                                </button>
                            ))}
                        {searchTerm.trim().length >= 2 && !searchError && peopleToShow.length === 0 && (
                            <p className="search-empty">No users found.</p>
                        )}
                        <button
                            className="cancel-new-chat"
                            onClick={() => { setShowNewChat(false); setSearchTerm(""); setSearchResults([]); }}
                        >
                            Cancel
                        </button>
                    </div>
                )}

                <div className="conversation-list">
                    {conversations.map(conversation => (
                        <button
                            key={conversation.id}
                            className={
                                selectedConversation?.id === conversation.id
                                    ? "conversation active"
                                    : "conversation"
                            }
                            onClick={() => {
                                setSelectedConversation(conversation);
                                setMessages([]);
                                setSummaryData(null);
                                setShowSummary(false);
                            }}
                        >
                            <span className="conversation-icon">
                                {conversation.is_group ? "👥" : "👤"}
                            </span>
                            <span>{getConversationName(conversation)}</span>
                        </button>
                    ))}
                </div>
            </aside>

            {/* =================================================
                MAIN CHAT
            ================================================= */}
            <section className={`chat-area ${showSummary && summaryData ? "has-summary" : ""}`}>
                {!selectedConversation ? (
                    <div className="empty-chat">
                        <div className="empty-chat-icon">✦</div>
                        <p className="eyebrow">YOUR INBOX</p>
                        <h2>Your conversations, in one calm space.</h2>
                        <p>Select a conversation from the sidebar or start a new chat.</p>
                        <button className="empty-chat-action" onClick={() => setShowNewChat(true)}>Start a conversation</button>
                    </div>
                ) : (
                    <>
                        {/* Step 16: CHAT HEADER */}
                        <header className="chat-header">
                            <div>
                                <h2>
                                    {selectedConversation.is_group
                                        ? `👥 ${selectedConversation.name}`
                                        : `👤 ${selectedConversation.display_name}`}
                                </h2>
                                <p>
                                    {selectedConversation.is_group
                                        ? "Group conversation"
                                        : "Private conversation"}
                                </p>
                            </div>
                            <button className="summary-trigger" onClick={generateSummary} disabled={summaryLoading}>
                                {summaryLoading ? "Building summary…" : "AI Summary"}
                            </button>
                        </header>

                        {summaryError && <p className="summary-error">{summaryError}</p>}
                        {showSummary && summaryData && (
                            <aside className="summary-panel" aria-label="AI conversation summary">
                                <div className="summary-heading"><div><p className="eyebrow">AI CONVERSATION SUMMARY</p><h3>Key moments</h3></div><button onClick={() => setShowSummary(false)} aria-label="Close summary">×</button></div>
                                <p className="summary-overview">{summaryData.summary?.overview || summaryData.items.map(item => item.text).join(" ")}</p>
                                {summaryData.summary?.key_topics.length ? <div className="summary-topics"><span>Key topics</span>{summaryData.summary.key_topics.map((topic, index) => <em key={`${topic.topic}-${index}`}>{topic.topic}</em>)}</div> : null}
                                {summaryData.summary?.action_items.length ? <section className="summary-section"><h4>Action items</h4>{summaryData.summary.action_items.map((item, index) => <article key={`action-${index}`}><p><strong>{item.person}</strong> — {item.task}</p>{item.deadline && <small>Due: {item.deadline}</small>}<footer>{sourceButton(item.source_message_ids)}</footer></article>)}</section> : null}
                                {summaryData.summary?.decisions.length ? <section className="summary-section"><h4>Decisions</h4>{summaryData.summary.decisions.map((item, index) => <article key={`decision-${index}`}><p>{item.text}</p><footer>{sourceButton(item.source_message_ids)}</footer></article>)}</section> : null}
                                {summaryData.summary?.important_points.length ? <section className="summary-section"><h4>Important points</h4>{summaryData.summary.important_points.map((item, index) => <article key={`point-${index}`}><p>{item.text}</p><footer>{sourceButton(item.source_message_ids)}</footer></article>)}</section> : null}
                                {summaryData.summary?.open_questions.length ? <section className="summary-section"><h4>Open questions</h4>{summaryData.summary.open_questions.map((item, index) => <article key={`question-${index}`}><p>{item.text}</p><footer>{sourceButton(item.source_message_ids)}</footer></article>)}</section> : null}
                                {summaryData.graph && <details className="analysis-details"><summary>Analysis details</summary><dl><div><dt>Nodes</dt><dd>{summaryData.graph.nodes}</dd></div><div><dt>Edges</dt><dd>{summaryData.graph.edges}</dd></div><div><dt>Clusters</dt><dd>{summaryData.graph.clusters}</dd></div><div><dt>Selected</dt><dd>{summaryData.graph.selectedMessageCount}</dd></div><div><dt>Algorithm</dt><dd>{summaryData.graph.algorithmVersion}</dd></div></dl></details>}
                            </aside>
                        )}

                        {/* MESSAGES */}
                        <div className="messages">
                            {messages.map(msg => {
                                const isOwn = Number(msg.sender_id) === Number(currentUser?.id);
                                const isHighlighted = highlightedMessageId === msg.id;
                                return (
                                    <div
                                        key={msg.id}
                                        id={`message-${msg.id}`}
                                        className={`message ${isOwn ? "own" : ""} ${isHighlighted ? "highlighted" : ""}`}
                                    >
                                        {!isOwn && <div className="sender">{msg.sender_name}</div>}
                                        <div className="message-content">{msg.content}</div>
                                        <div className="message-meta">
                                            <span className="message-time">
                                                {new Date(msg.created_at).toLocaleTimeString([], {
                                                    hour: "2-digit",
                                                    minute: "2-digit"
                                                })}
                                            </span>
                                            {isOwn && (
                                                <span
                                                    className={`read-receipt ${msg.is_read ? "read" : "sent"}`}
                                                    title={msg.is_read ? "Read" : "Sent"}
                                                    aria-label={msg.is_read ? "Read receipt: Seen" : "Read receipt: Sent"}
                                                >
                                                    {msg.is_read ? "✓✓" : "✓"}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* MESSAGE INPUT */}
                        <div className="message-input">
                            <input
                                type="text"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a message..."
                            />
                            <button onClick={sendMessage} aria-label="Send message"><span>Send</span><span aria-hidden="true">→</span></button>
                        </div>
                    </>
                )}

                {/* =================================================
                    GROUP CREATION MODAL
                ================================================= */}
                {showGroupForm && (
                    <div className="group-modal">
                        <div className="group-form">
                            <h2>Create Group</h2>
                            <input
                                type="text"
                                placeholder="Group name"
                                value={groupName}
                                onChange={e => setGroupName(e.target.value)}
                            />

                            <h3>Select Members</h3>

                            <div className="member-list">
                                {users
                                    .filter(user => user.id !== currentUser?.id)
                                    .map(user => (
                                        <label key={user.id} className="member-option">
                                            <input
                                                type="checkbox"
                                                checked={selectedMembers.includes(user.id)}
                                                onChange={() => toggleMember(user.id)}
                                            />
                                            {user.display_name || user.username}
                                        </label>
                                    ))}
                            </div>

                            <div className="group-actions">
                                <button onClick={() => setShowGroupForm(false)}>
                                    Cancel
                                </button>
                                <button onClick={createGroup}>Create Group</button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}
