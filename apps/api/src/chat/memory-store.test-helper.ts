import type {
  ChatMessageCursor,
  ChatMessageRecord,
  ChatThreadReadRecord,
  ChatThreadRecord
} from "./types.js";
import type {
  ChatStore,
  CreateChatMessageInput,
  CreateChatThreadInput
} from "./store.js";

export class MemoryChatStore implements ChatStore {
  readonly threads = new Map<string, ChatThreadRecord>();
  readonly messages = new Map<string, ChatMessageRecord>();
  readonly reads = new Map<string, ChatThreadReadRecord>();

  async getThreadById(id: string): Promise<ChatThreadRecord | null> {
    return this.threads.get(id) ?? null;
  }

  async getThreadByMatchId(matchId: string): Promise<ChatThreadRecord | null> {
    return (
      [...this.threads.values()].find((thread) => thread.matchId === matchId) ?? null
    );
  }

  async createThread(input: CreateChatThreadInput): Promise<ChatThreadRecord> {
    const existing = await this.getThreadByMatchId(input.matchId);

    if (existing) {
      return existing;
    }

    const thread = {
      ...input,
      createdAt: new Date(),
      lastMessageAt: null
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async listThreadsForUser(userId: string): Promise<ChatThreadRecord[]> {
    return [...this.threads.values()]
      .filter(
        (thread) => thread.creatorUserId === userId || thread.brandUserId === userId
      )
      .sort((left, right) => {
        const leftDate = left.lastMessageAt ?? left.createdAt;
        const rightDate = right.lastMessageAt ?? right.createdAt;
        const byDate = rightDate.getTime() - leftDate.getTime();

        if (byDate !== 0) {
          return byDate;
        }

        return right.id.localeCompare(left.id);
      });
  }

  async listMessages(input: {
    threadId: string;
    cursor: ChatMessageCursor | null;
    limit: number;
  }): Promise<ChatMessageRecord[]> {
    return this.threadMessages(input.threadId)
      .filter((message) => {
        if (!input.cursor) {
          return true;
        }

        return (
          message.createdAt.getTime() < input.cursor.createdAt.getTime() ||
          (message.createdAt.getTime() === input.cursor.createdAt.getTime() &&
            message.id < input.cursor.id)
        );
      })
      .slice(0, input.limit);
  }

  async getLastMessage(threadId: string): Promise<ChatMessageRecord | null> {
    return this.threadMessages(threadId)[0] ?? null;
  }

  async getMessageById(id: string): Promise<ChatMessageRecord | null> {
    return this.messages.get(id) ?? null;
  }

  async createMessage(input: CreateChatMessageInput): Promise<{
    message: ChatMessageRecord;
    created: boolean;
  }> {
    if (input.clientMessageId) {
      const existing = [...this.messages.values()].find(
        (message) =>
          message.threadId === input.threadId &&
          message.senderUserId === input.senderUserId &&
          message.clientMessageId === input.clientMessageId
      );

      if (existing) {
        return { message: existing, created: false };
      }
    }

    const message = {
      ...input,
      createdAt: new Date()
    };
    this.messages.set(message.id, message);

    const thread = this.threads.get(input.threadId);
    if (thread) {
      this.threads.set(thread.id, {
        ...thread,
        lastMessageAt: message.createdAt
      });
    }

    return { message, created: true };
  }

  async markThreadRead(input: {
    threadId: string;
    userId: string;
    lastReadAt: Date;
  }): Promise<ChatThreadReadRecord> {
    const key = readKey(input.threadId, input.userId);
    const existing = this.reads.get(key);
    const nextDate =
      existing && existing.lastReadAt.getTime() > input.lastReadAt.getTime()
        ? existing.lastReadAt
        : input.lastReadAt;
    const record = {
      threadId: input.threadId,
      userId: input.userId,
      lastReadAt: nextDate,
      updatedAt: new Date()
    };
    this.reads.set(key, record);
    return record;
  }

  async getThreadRead(input: {
    threadId: string;
    userId: string;
  }): Promise<ChatThreadReadRecord | null> {
    return this.reads.get(readKey(input.threadId, input.userId)) ?? null;
  }

  async countUnread(input: {
    threadId: string;
    userId: string;
    since: Date | null;
  }): Promise<number> {
    return this.threadMessages(input.threadId).filter(
      (message) =>
        message.senderUserId !== input.userId &&
        (!input.since || message.createdAt.getTime() > input.since.getTime())
    ).length;
  }

  private threadMessages(threadId: string): ChatMessageRecord[] {
    return [...this.messages.values()]
      .filter((message) => message.threadId === threadId)
      .sort((left, right) => {
        const byDate = right.createdAt.getTime() - left.createdAt.getTime();

        if (byDate !== 0) {
          return byDate;
        }

        return right.id.localeCompare(left.id);
      });
  }
}

function readKey(threadId: string, userId: string): string {
  return `${threadId}:${userId}`;
}
