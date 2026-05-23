"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiRequest, apiUrl, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate, PageHeader, PageShell, StatusPill } from "../ui";

type ChatAttachment = {
  type: "image" | "video";
  url: string;
};

type ChatMessage = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  attachment: ChatAttachment | null;
  createdAt: string;
};

type ChatThreadSummary = {
  thread: {
    id: string;
    matchId: string;
    createdAt: string;
    lastMessageAt: string | null;
  };
  campaign: {
    title: string;
  } | null;
  creatorProfile: {
    displayName: string;
  } | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
};

type SocketAck = {
  ok?: boolean;
  error?: {
    code?: string;
  };
  message?: ChatMessage;
  thread?: ChatThreadSummary;
};

type NewMessageEvent = {
  message: ChatMessage;
  thread: ChatThreadSummary;
};

export default function ChatPage() {
  const auth = useAuth();
  const { formatDate, t } = useI18n();
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const selectedThreadIdRef = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentType, setAttachmentType] = useState<"image" | "video">("image");
  const [loading, setLoading] = useState(false);
  const [connectionState, setConnectionState] = useState("offline");
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );
  const totalUnread = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadThreads = useCallback(async () => {
    if (!auth.accessToken) {
      return;
    }

    setError(null);
    const payload = await apiRequest<{ threads: ChatThreadSummary[] }>(
      "/chat/threads",
      { method: "GET" },
      auth.accessToken
    );
    setThreads(payload.threads);

    const urlThreadId = new URLSearchParams(window.location.search).get("thread");
    const nextSelected =
      urlThreadId ?? selectedThreadId ?? payload.threads[0]?.thread.id ?? null;

    if (nextSelected) {
      setSelectedThreadId(nextSelected);
    }
  }, [auth.accessToken, selectedThreadId]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      if (!auth.accessToken) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const payload = await apiRequest<{ messages: ChatMessage[] }>(
          `/chat/threads/${threadId}/messages?limit=50`,
          { method: "GET" },
          auth.accessToken
        );
        setMessages(payload.messages);
        await apiRequest(
          `/chat/threads/${threadId}/read`,
          { body: JSON.stringify({}), method: "POST" },
          auth.accessToken
        );
        setThreads((current) =>
          current.map((thread) =>
            thread.thread.id === threadId ? { ...thread, unreadCount: 0 } : thread
          )
        );
        socketRef.current?.emit("thread:read", { threadId });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "LOAD_FAILED");
      } finally {
        setLoading(false);
      }
    },
    [auth.accessToken]
  );

  useEffect(() => {
    if (!auth.accessToken) {
      return;
    }

    const nextSocket = io(apiUrl, {
      auth: { token: auth.accessToken },
      transports: ["websocket"]
    });

    nextSocket.on("connect", () => setConnectionState("online"));
    nextSocket.on("disconnect", () => setConnectionState("reconnecting"));
    nextSocket.on("connect_error", () => setConnectionState("offline"));
    nextSocket.on("message:new", (event: NewMessageEvent) => {
      setThreads((current) => upsertThread(current, event.thread));
      if (event.message.threadId === selectedThreadIdRef.current) {
        setMessages((current) => addUniqueMessage(current, event.message));
        nextSocket.emit("thread:read", { threadId: selectedThreadIdRef.current });
      }
    });
    nextSocket.on(
      "notification:unread",
      (event: { threadId: string; unreadCount: number }) => {
        setThreads((current) =>
          current.map((thread) =>
            thread.thread.id === event.threadId
              ? { ...thread, unreadCount: event.unreadCount }
              : thread
          )
        );
      }
    );

    socketRef.current = nextSocket;
    return () => {
      nextSocket.disconnect();
      socketRef.current = null;
    };
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.loading && auth.accessToken) {
      void Promise.resolve().then(() =>
        loadThreads().catch((caught) =>
          setError(caught instanceof Error ? caught.message : "LOAD_FAILED")
        )
      );
    }
  }, [auth.accessToken, auth.loading, loadThreads]);

  useEffect(() => {
    if (socketRef.current && selectedThreadId) {
      void Promise.resolve().then(() => {
        socketRef.current?.emit("thread:join", { threadId: selectedThreadId });
        return loadMessages(selectedThreadId);
      });
    }
  }, [loadMessages, selectedThreadId]);

  async function sendMessage() {
    const socket = socketRef.current;

    if (!selectedThreadId || !socket || !body.trim()) {
      return;
    }

    setError(null);
    const attachment = attachmentUrl.trim()
      ? { type: attachmentType, url: attachmentUrl.trim() }
      : null;
    const payload = {
      threadId: selectedThreadId,
      body,
      attachment,
      clientMessageId: crypto.randomUUID()
    };

    socket.emit("message:send", payload, (ack: SocketAck) => {
      if (!ack.ok || !ack.message) {
        setError(ack.error?.code ?? "SEND_FAILED");
        return;
      }

      setMessages((current) => addUniqueMessage(current, ack.message!));
      if (ack.thread) {
        setThreads((current) => upsertThread(current, ack.thread!));
      }
      setBody("");
      setAttachmentUrl("");
    });
  }

  async function reportMessage(message: ChatMessage) {
    if (!auth.accessToken) {
      return;
    }

    setError(null);

    try {
      await apiRequest(
        "/moderation/reports",
        {
          body: JSON.stringify({
            targetType: "chat_message",
            targetId: message.id,
            reason: "Chat message report"
          }),
          method: "POST"
        },
        auth.accessToken
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "REPORT_FAILED");
    }
  }

  if (auth.loading) {
    return (
      <PageShell wide>
        <div className="chat-loading">
          <div className="chat-loading-spinner" />
          <p>{t("chat.loading")}</p>
        </div>
      </PageShell>
    );
  }

  if (!auth.user) {
    return (
      <Gate
        buttonLabel={t("nav.backHome")}
        title={t("error.UNAUTHORIZED")}
        message={t("chat.unauthorized")}
      />
    );
  }

  return (
    <PageShell wide>
      <PageHeader
        eyebrow={t("nav.chat")}
        title={
          totalUnread
            ? `${t("chat.conversations")} (${totalUnread})`
            : t("chat.conversations")
        }
        action={
          <div className="chat-header-actions">
            <StatusPill>
              <span
                className={`connection-dot ${connectionState === "online" ? "online" : connectionState === "reconnecting" ? "reconnecting" : "offline"}`}
              />
              {t(`status.${connectionState}`)}
            </StatusPill>
            <Link href="/" className="button secondary">
              {t("nav.home")}
            </Link>
          </div>
        }
      />

      <div className="chat-container">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <span className="chat-sidebar-title">{t("chat.threads")}</span>
            {threads.length > 0 && (
              <span className="chat-thread-count">{threads.length}</span>
            )}
          </div>
          <div className="chat-thread-list">
            {threads.length === 0 ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p>{t("chat.emptyThreads")}</p>
              </div>
            ) : null}
            {threads.map((thread) => (
              <button
                className={`chat-thread-item ${selectedThreadId === thread.thread.id ? "active" : ""}`}
                key={thread.thread.id}
                onClick={() => setSelectedThreadId(thread.thread.id)}
                type="button"
              >
                <div className="chat-thread-avatar">
                  {(
                    thread.creatorProfile?.displayName?.[0] ||
                    thread.campaign?.title?.[0] ||
                    "C"
                  ).toUpperCase()}
                </div>
                <div className="chat-thread-content">
                  <div className="chat-thread-header">
                    <strong className="chat-thread-name">
                      {thread.campaign?.title ?? t("chat.campaignChat")}
                    </strong>
                    {thread.unreadCount > 0 && (
                      <span className="chat-unread-badge">{thread.unreadCount}</span>
                    )}
                  </div>
                  <span className="chat-thread-subtitle">
                    {thread.creatorProfile?.displayName ?? t("role.creator")}
                  </span>
                  {thread.lastMessage && (
                    <span className="chat-thread-preview">
                      {thread.lastMessage.body || t("chat.attachment")}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-main">
          {!selectedThread ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>{t("chat.select")}</h3>
              <p className="chat-empty-hint">{t("chat.selectHint")}</p>
            </div>
          ) : (
            <>
              <div className="chat-panel-header">
                <div className="chat-panel-info">
                  <div className="chat-panel-avatar">
                    {(
                      selectedThread.creatorProfile?.displayName?.[0] ||
                      selectedThread.campaign?.title?.[0] ||
                      "C"
                    ).toUpperCase()}
                  </div>
                  <div>
                    <strong className="chat-panel-name">
                      {selectedThread.campaign?.title ?? t("chat.campaignChat")}
                    </strong>
                    <span className="chat-panel-subtitle">
                      {selectedThread.creatorProfile?.displayName ?? t("role.creator")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="chat-messages">
                {messages.length === 0 && !loading ? (
                  <div className="chat-empty-state small">
                    <p>{t("chat.emptyMessages")}</p>
                  </div>
                ) : null}
                {loading && (
                  <div className="chat-loading-messages">
                    <div className="chat-loading-spinner small" />
                  </div>
                )}
                {messages.map((message) => (
                  <article
                    className={`chat-message ${message.senderUserId === auth.user?.id ? "outgoing" : "incoming"}`}
                    key={message.id}
                  >
                    <div className="chat-message-bubble">
                      {message.body && <p>{message.body}</p>}
                      {message.attachment && (
                        <AttachmentPreview attachment={message.attachment} />
                      )}
                      <div className="chat-message-meta">
                        <time>{formatDate(message.createdAt)}</time>
                        <button
                          className="chat-report-btn"
                          onClick={() => reportMessage(message)}
                          type="button"
                          title={t("action.report")}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                            <line x1="4" y1="22" x2="4" y2="15" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-composer">
                <div className="chat-composer-main">
                  <textarea
                    className="chat-input"
                    onChange={(event) => setBody(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={t("chat.message")}
                    value={body}
                    rows={1}
                  />
                  <button
                    className="chat-send-btn"
                    onClick={sendMessage}
                    type="button"
                    disabled={!body.trim()}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
                <div className="chat-attachment-row">
                  <select
                    className="chat-attachment-type"
                    onChange={(event) =>
                      setAttachmentType(event.target.value as "image" | "video")
                    }
                    value={attachmentType}
                  >
                    <option value="image">{t("chat.image")}</option>
                    <option value="video">{t("chat.video")}</option>
                  </select>
                  <input
                    className="chat-attachment-url"
                    onChange={(event) => setAttachmentUrl(event.target.value)}
                    placeholder={t("chat.attachmentUrl")}
                    value={attachmentUrl}
                  />
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {error && <p className="error">{error}</p>}
    </PageShell>
  );
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.type === "video") {
    return <video className="chat-media" controls src={attachment.url} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" className="chat-media" src={attachment.url} />;
}

function addUniqueMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((item) => item.id === message.id)) {
    return messages;
  }

  return [...messages, message].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function upsertThread(
  threads: ChatThreadSummary[],
  thread: ChatThreadSummary
): ChatThreadSummary[] {
  const next = [thread, ...threads.filter((item) => item.thread.id !== thread.thread.id)];

  return next.sort((left, right) => {
    const leftDate = left.thread.lastMessageAt ?? left.thread.createdAt;
    const rightDate = right.thread.lastMessageAt ?? right.thread.createdAt;

    return new Date(rightDate).getTime() - new Date(leftDate).getTime();
  });
}
