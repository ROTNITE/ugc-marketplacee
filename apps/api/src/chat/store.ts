import type {
  ChatAttachment,
  ChatMessageCursor,
  ChatMessageRecord,
  ChatThreadReadRecord,
  ChatThreadRecord
} from "./types.js";

export type CreateChatThreadInput = {
  id: string;
  matchId: string;
  creatorUserId: string;
  brandUserId: string;
};

export type CreateChatMessageInput = {
  id: string;
  threadId: string;
  senderUserId: string;
  clientMessageId: string | null;
  body: string;
  attachment: ChatAttachment | null;
};

export type ChatStore = {
  getThreadById(id: string): Promise<ChatThreadRecord | null>;
  getThreadByMatchId(matchId: string): Promise<ChatThreadRecord | null>;
  createThread(input: CreateChatThreadInput): Promise<ChatThreadRecord>;
  listThreadsForUser(userId: string): Promise<ChatThreadRecord[]>;
  listMessages(input: {
    threadId: string;
    cursor: ChatMessageCursor | null;
    limit: number;
  }): Promise<ChatMessageRecord[]>;
  getMessageById(id: string): Promise<ChatMessageRecord | null>;
  getLastMessage(threadId: string): Promise<ChatMessageRecord | null>;
  createMessage(input: CreateChatMessageInput): Promise<{
    message: ChatMessageRecord;
    created: boolean;
  }>;
  markThreadRead(input: {
    threadId: string;
    userId: string;
    lastReadAt: Date;
  }): Promise<ChatThreadReadRecord>;
  getThreadRead(input: {
    threadId: string;
    userId: string;
  }): Promise<ChatThreadReadRecord | null>;
  countUnread(input: {
    threadId: string;
    userId: string;
    since: Date | null;
  }): Promise<number>;
};
