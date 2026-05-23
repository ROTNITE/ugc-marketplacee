"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiRequest, apiUrl, useAuth } from "../auth-context";
import { useI18n } from "../i18n";
import { Gate } from "../ui";

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

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );
  const totalUnread = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

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

    if (!selectedThreadId || !socket) {
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
    return <main className="auth-shell">{t("chat.loading")}</main>;
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
    <main className="chat-shell">
      <header className="feed-header">
        <div>
          <p className="eyebrow">{t("nav.chat")}</p>
          <h1>
            {t("chat.conversations")} {totalUnread ? `(${totalUnread})` : ""}
          </h1>
          <p>{t(`status.${connectionState}`)}</p>
        </div>
        <Link href="/">{t("nav.home")}</Link>
      </header>
      <section className="chat-layout">
        <aside className="thread-list">
          {threads.length === 0 ? <p>{t("chat.emptyThreads")}</p> : null}
          {threads.map((thread) => (
            <button
              className="thread-button"
              key={thread.thread.id}
              onClick={() => setSelectedThreadId(thread.thread.id)}
              type="button"
            >
              <strong>{thread.campaign?.title ?? t("chat.campaignChat")}</strong>
              <span>{thread.creatorProfile?.displayName ?? t("role.creator")}</span>
              {thread.lastMessage ? (
                <span>{thread.lastMessage.body || t("chat.attachment")}</span>
              ) : null}
              {thread.unreadCount ? <b>{thread.unreadCount}</b> : null}
            </button>
          ))}
        </aside>
        <section className="chat-panel">
          {!selectedThread ? <p>{t("chat.select")}</p> : null}
          {selectedThread ? (
            <>
              <div className="chat-title">
                <strong>
                  {selectedThread.campaign?.title ?? t("chat.campaignChat")}
                </strong>
                <span>
                  {selectedThread.creatorProfile?.displayName ?? t("role.creator")}
                </span>
              </div>
              <div className="message-list">
                {messages.length === 0 && !loading ? (
                  <p>{t("chat.emptyMessages")}</p>
                ) : null}
                {messages.map((message) => (
                  <article
                    className={
                      message.senderUserId === auth.user?.id ? "message mine" : "message"
                    }
                    key={message.id}
                  >
                    {message.body ? <p>{message.body}</p> : null}
                    {message.attachment ? (
                      <AttachmentPreview attachment={message.attachment} />
                    ) : null}
                    <small>{formatDate(message.createdAt)}</small>
                    <button
                      className="secondary"
                      onClick={() => reportMessage(message)}
                      type="button"
                    >
                      {t("action.report")}
                    </button>
                  </article>
                ))}
              </div>
              <div className="composer">
                <textarea
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={t("chat.message")}
                  value={body}
                />
                <div className="attachment-row">
                  <select
                    onChange={(event) =>
                      setAttachmentType(event.target.value as "image" | "video")
                    }
                    value={attachmentType}
                  >
                    <option value="image">{t("chat.image")}</option>
                    <option value="video">{t("chat.video")}</option>
                  </select>
                  <input
                    onChange={(event) => setAttachmentUrl(event.target.value)}
                    placeholder={t("chat.attachmentUrl")}
                    value={attachmentUrl}
                  />
                </div>
                <button onClick={sendMessage} type="button">
                  {t("chat.send")}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </section>
      {loading ? <p>{t("chat.loadingMessages")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.type === "video") {
    return <video className="message-media" controls src={attachment.url} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" className="message-media" src={attachment.url} />;
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
