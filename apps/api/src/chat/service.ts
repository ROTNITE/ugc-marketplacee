import { randomUUID } from "node:crypto";
import { AuthError, authErrors } from "../auth/errors.js";
import type { AccessTokenClaims } from "../auth/security.js";
import type { MarketplaceStore } from "../marketplace/store.js";
import type { MatchRecord } from "../marketplace/types.js";
import type { Notifier } from "../notifications/notifier.js";
import { NoopNotifier } from "../notifications/notifier.js";
import type { ChatStore } from "./store.js";
import type {
  ChatAttachment,
  ChatAttachmentType,
  ChatMessagePage,
  ChatMessageRecord,
  ChatThreadRecord,
  ChatThreadSummary
} from "./types.js";

export class ChatService {
  private readonly notifier: Notifier;
  constructor(
    private readonly store: ChatStore,
    private readonly marketplaceStore: MarketplaceStore,
    notifier?: Notifier
  ) {
    this.notifier = notifier ?? new NoopNotifier();
  }

  async listThreads(auth: AccessTokenClaims): Promise<{ threads: ChatThreadSummary[] }> {
    const threads = await this.store.listThreadsForUser(auth.sub);
    const summaries = await Promise.all(
      threads.map((thread) => this.summarizeThread(auth.sub, thread))
    );

    return { threads: summaries };
  }

  async createThread(
    auth: AccessTokenClaims,
    body: unknown
  ): Promise<{ thread: ChatThreadSummary }> {
    const matchId = parseMatchId(body);
    const match = await this.getAuthorizedMatch(auth, matchId);
    const thread = await this.store.createThread({
      id: randomUUID(),
      matchId: match.id,
      creatorUserId: match.creatorUserId,
      brandUserId: match.brandUserId
    });

    return { thread: await this.summarizeThread(auth.sub, thread, match) };
  }

  async listMessages(
    auth: AccessTokenClaims,
    threadId: string,
    query: { cursor?: unknown; limit?: unknown }
  ): Promise<ChatMessagePage> {
    const thread = await this.getAuthorizedThread(auth, threadId);
    const limit = parseLimit(query.limit);
    const cursor = parseCursor(query.cursor);
    const messages = await this.store.listMessages({
      threadId: thread.id,
      cursor,
      limit: limit + 1
    });
    const visible = messages.slice(0, limit);
    const hasMore = messages.length > limit;

    return {
      messages: visible.reverse(),
      nextCursor: hasMore ? encodeCursor(visible[visible.length - 1]) : null
    };
  }

  async sendMessage(
    auth: AccessTokenClaims,
    threadId: string,
    body: unknown
  ): Promise<{
    message: ChatMessageRecord;
    created: boolean;
    thread: ChatThreadSummary;
    recipientUserId: string;
    recipientUnreadCount: number;
  }> {
    const thread = await this.getAuthorizedThread(auth, threadId);
    const input = parseMessageInput(body);
    const { message, created } = await this.store.createMessage({
      id: randomUUID(),
      threadId: thread.id,
      senderUserId: auth.sub,
      ...input
    });
    const recipientUserId = getOtherParticipant(thread, auth.sub);
    const recipientRead = await this.store.getThreadRead({
      threadId: thread.id,
      userId: recipientUserId
    });

    if (created) {
      await this.notifier.notifyNewChatMessage({
        recipientUserId,
        senderUserId: auth.sub,
        threadId: thread.id,
        preview: message.body
      });
    }

    return {
      message,
      created,
      thread: await this.summarizeThread(auth.sub, thread),
      recipientUserId,
      recipientUnreadCount: await this.store.countUnread({
        threadId: thread.id,
        userId: recipientUserId,
        since: recipientRead?.lastReadAt ?? null
      })
    };
  }

  async markRead(
    auth: AccessTokenClaims,
    threadId: string
  ): Promise<{
    threadId: string;
    userId: string;
    lastReadAt: Date;
    unreadCount: number;
  }> {
    const thread = await this.getAuthorizedThread(auth, threadId);
    const lastMessage = await this.store.getLastMessage(thread.id);
    const read = await this.store.markThreadRead({
      threadId: thread.id,
      userId: auth.sub,
      lastReadAt: lastMessage?.createdAt ?? new Date()
    });

    return {
      threadId: thread.id,
      userId: auth.sub,
      lastReadAt: read.lastReadAt,
      unreadCount: await this.store.countUnread({
        threadId: thread.id,
        userId: auth.sub,
        since: read.lastReadAt
      })
    };
  }

  async getAuthorizedThread(
    auth: AccessTokenClaims,
    threadId: string
  ): Promise<ChatThreadRecord> {
    const thread = await this.store.getThreadById(threadId);

    if (!thread || !isThreadParticipant(thread, auth.sub)) {
      throw chatErrors.notFound();
    }

    return thread;
  }

  private async summarizeThread(
    userId: string,
    thread: ChatThreadRecord,
    knownMatch?: MatchRecord
  ): Promise<ChatThreadSummary> {
    const match =
      knownMatch ??
      (await this.marketplaceStore
        .listMatchesForUser(userId)
        .then((matches) => matches.find((item) => item.id === thread.matchId) ?? null)) ??
      null;
    const read = await this.store.getThreadRead({ threadId: thread.id, userId });

    return {
      thread,
      match,
      campaign: match
        ? await this.marketplaceStore.getCampaignById(match.campaignId)
        : null,
      creatorProfile: match
        ? await this.marketplaceStore.getProfile(match.creatorUserId)
        : null,
      lastMessage: await this.store.getLastMessage(thread.id),
      unreadCount: await this.store.countUnread({
        threadId: thread.id,
        userId,
        since: read?.lastReadAt ?? null
      }),
      lastReadAt: read?.lastReadAt ?? null
    };
  }

  private async getAuthorizedMatch(
    auth: AccessTokenClaims,
    matchId: string
  ): Promise<MatchRecord> {
    const matches = await this.marketplaceStore.listMatchesForUser(auth.sub);
    const match = matches.find((item) => item.id === matchId && item.status === "active");

    if (!match) {
      throw chatErrors.notFound();
    }

    return match;
  }
}

export const chatErrors = {
  invalidCursor: () =>
    new AuthError("INVALID_CURSOR", "Pagination cursor is invalid.", 400),
  invalidPayload: () => authErrors.invalidPayload(),
  notFound: () => new AuthError("NOT_FOUND", "Resource was not found.", 404)
};

function parseMatchId(body: unknown): string {
  if (!isRecord(body) || typeof body.matchId !== "string" || !body.matchId.trim()) {
    throw chatErrors.invalidPayload();
  }

  return body.matchId.trim();
}

function parseMessageInput(body: unknown): {
  clientMessageId: string | null;
  body: string;
  attachment: ChatAttachment | null;
} {
  if (!isRecord(body)) {
    throw chatErrors.invalidPayload();
  }

  const text = parseOptionalString(body.body, 2000);
  const attachment = parseAttachment(body.attachment);
  const clientMessageId =
    typeof body.clientMessageId === "string" && body.clientMessageId.trim()
      ? body.clientMessageId.trim().slice(0, 120)
      : null;

  if (!text && !attachment) {
    throw chatErrors.invalidPayload();
  }

  return {
    clientMessageId,
    body: text,
    attachment
  };
}

function parseAttachment(value: unknown): ChatAttachment | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw chatErrors.invalidPayload();
  }
  if (value.type !== "image" && value.type !== "video") {
    throw chatErrors.invalidPayload();
  }
  if (typeof value.url !== "string") {
    throw chatErrors.invalidPayload();
  }

  const url = value.url.trim();

  if (!url || !isSafeUrlOrPath(url) || inferAttachmentType(url) !== value.type) {
    throw chatErrors.invalidPayload();
  }

  return { type: value.type, url };
}

function parseOptionalString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw chatErrors.invalidPayload();
  }

  return value.trim();
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 30);

  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw chatErrors.invalidPayload();
  }

  return limit;
}

function parseCursor(value: unknown): { createdAt: Date; id: string } | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw chatErrors.invalidCursor();
  }

  const separator = value.lastIndexOf("_");

  if (separator <= 0 || separator === value.length - 1) {
    throw chatErrors.invalidCursor();
  }

  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);

  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw chatErrors.invalidCursor();
  }

  return { createdAt, id };
}

function encodeCursor(message: ChatMessageRecord | undefined): string | null {
  if (!message) {
    return null;
  }

  return `${message.createdAt.toISOString()}_${message.id}`;
}

function isSafeUrlOrPath(value: string): boolean {
  if (value.startsWith("/")) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function inferAttachmentType(value: string): ChatAttachmentType | null {
  const pathname = value.startsWith("/") ? value : new URL(value).pathname;
  const normalized = pathname.toLowerCase();

  if (/\.(jpg|jpeg|png|gif|webp)$/.test(normalized)) {
    return "image";
  }
  if (/\.(mp4|webm|mov|m4v)$/.test(normalized)) {
    return "video";
  }

  return null;
}

function isThreadParticipant(thread: ChatThreadRecord, userId: string): boolean {
  return thread.creatorUserId === userId || thread.brandUserId === userId;
}

function getOtherParticipant(thread: ChatThreadRecord, userId: string): string {
  return thread.creatorUserId === userId ? thread.brandUserId : thread.creatorUserId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
