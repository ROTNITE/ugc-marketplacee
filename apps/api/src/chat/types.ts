import type { CampaignRecord, MatchRecord, ProfileRecord } from "../marketplace/types.js";

export type ChatAttachmentType = "image" | "video";

export type ChatAttachment = {
  type: ChatAttachmentType;
  url: string;
};

export type ChatThreadRecord = {
  id: string;
  matchId: string;
  creatorUserId: string;
  brandUserId: string;
  createdAt: Date;
  lastMessageAt: Date | null;
};

export type ChatMessageRecord = {
  id: string;
  threadId: string;
  senderUserId: string;
  clientMessageId: string | null;
  body: string;
  attachment: ChatAttachment | null;
  createdAt: Date;
};

export type ChatThreadReadRecord = {
  threadId: string;
  userId: string;
  lastReadAt: Date;
  updatedAt: Date;
};

export type ChatMessageCursor = {
  createdAt: Date;
  id: string;
};

export type ChatThreadSummary = {
  thread: ChatThreadRecord;
  match: MatchRecord | null;
  campaign: CampaignRecord | null;
  creatorProfile: ProfileRecord | null;
  lastMessage: ChatMessageRecord | null;
  unreadCount: number;
  lastReadAt: Date | null;
};

export type ChatMessagePage = {
  messages: ChatMessageRecord[];
  nextCursor: string | null;
};
