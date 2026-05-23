import pg from "pg";
import type {
  ChatAttachment,
  ChatAttachmentType,
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

type ThreadRow = {
  id: string;
  match_id: string;
  creator_user_id: string;
  brand_user_id: string;
  created_at: Date;
  last_message_at: Date | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  client_message_id: string | null;
  body: string;
  attachment_url: string | null;
  attachment_type: ChatAttachmentType | null;
  created_at: Date;
};

type ReadRow = {
  thread_id: string;
  user_id: string;
  last_read_at: Date;
  updated_at: Date;
};

type CountRow = {
  count: string;
};

export class PgChatStore implements ChatStore {
  constructor(private readonly pool: pg.Pool) {}

  async getThreadById(id: string): Promise<ChatThreadRecord | null> {
    const result = await this.pool.query<ThreadRow>(
      "SELECT * FROM chat_threads WHERE id = $1",
      [id]
    );

    return result.rows[0] ? mapThread(result.rows[0]) : null;
  }

  async getThreadByMatchId(matchId: string): Promise<ChatThreadRecord | null> {
    const result = await this.pool.query<ThreadRow>(
      "SELECT * FROM chat_threads WHERE match_id = $1",
      [matchId]
    );

    return result.rows[0] ? mapThread(result.rows[0]) : null;
  }

  async createThread(input: CreateChatThreadInput): Promise<ChatThreadRecord> {
    const result = await this.pool.query<ThreadRow>(
      `
        INSERT INTO chat_threads (id, match_id, creator_user_id, brand_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (match_id)
        DO UPDATE SET match_id = chat_threads.match_id
        RETURNING *
      `,
      [input.id, input.matchId, input.creatorUserId, input.brandUserId]
    );

    return mapThread(result.rows[0]);
  }

  async listThreadsForUser(userId: string): Promise<ChatThreadRecord[]> {
    const result = await this.pool.query<ThreadRow>(
      `
        SELECT * FROM chat_threads
        WHERE creator_user_id = $1 OR brand_user_id = $1
        ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
      `,
      [userId]
    );

    return result.rows.map(mapThread);
  }

  async listMessages(input: {
    threadId: string;
    cursor: ChatMessageCursor | null;
    limit: number;
  }): Promise<ChatMessageRecord[]> {
    const result = await this.pool.query<MessageRow>(
      `
        SELECT * FROM chat_messages
        WHERE thread_id = $1
          AND (
            $2::timestamptz IS NULL
            OR created_at < $2::timestamptz
            OR (created_at = $2::timestamptz AND id < $3)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `,
      [
        input.threadId,
        input.cursor?.createdAt ?? null,
        input.cursor?.id ?? null,
        input.limit
      ]
    );

    return result.rows.map(mapMessage);
  }

  async getLastMessage(threadId: string): Promise<ChatMessageRecord | null> {
    const result = await this.pool.query<MessageRow>(
      `
        SELECT * FROM chat_messages
        WHERE thread_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [threadId]
    );

    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  async getMessageById(id: string): Promise<ChatMessageRecord | null> {
    const result = await this.pool.query<MessageRow>(
      "SELECT * FROM chat_messages WHERE id = $1",
      [id]
    );

    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  async createMessage(input: CreateChatMessageInput): Promise<{
    message: ChatMessageRecord;
    created: boolean;
  }> {
    if (input.clientMessageId) {
      const existing = await this.pool.query<MessageRow>(
        `
          SELECT * FROM chat_messages
          WHERE thread_id = $1 AND sender_user_id = $2 AND client_message_id = $3
        `,
        [input.threadId, input.senderUserId, input.clientMessageId]
      );

      if (existing.rows[0]) {
        return { message: mapMessage(existing.rows[0]), created: false };
      }
    }

    const result = await this.pool.query<MessageRow>(
      `
        INSERT INTO chat_messages (
          id, thread_id, sender_user_id, client_message_id,
          body, attachment_url, attachment_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        input.id,
        input.threadId,
        input.senderUserId,
        input.clientMessageId,
        input.body,
        input.attachment?.url ?? null,
        input.attachment?.type ?? null
      ]
    );

    await this.pool.query("UPDATE chat_threads SET last_message_at = $2 WHERE id = $1", [
      input.threadId,
      result.rows[0]?.created_at ?? new Date()
    ]);

    return { message: mapMessage(result.rows[0]), created: true };
  }

  async markThreadRead(input: {
    threadId: string;
    userId: string;
    lastReadAt: Date;
  }): Promise<ChatThreadReadRecord> {
    const result = await this.pool.query<ReadRow>(
      `
        INSERT INTO chat_thread_reads (thread_id, user_id, last_read_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (thread_id, user_id)
        DO UPDATE SET
          last_read_at = GREATEST(chat_thread_reads.last_read_at, EXCLUDED.last_read_at),
          updated_at = now()
        RETURNING *
      `,
      [input.threadId, input.userId, input.lastReadAt]
    );

    return mapRead(result.rows[0]);
  }

  async getThreadRead(input: {
    threadId: string;
    userId: string;
  }): Promise<ChatThreadReadRecord | null> {
    const result = await this.pool.query<ReadRow>(
      "SELECT * FROM chat_thread_reads WHERE thread_id = $1 AND user_id = $2",
      [input.threadId, input.userId]
    );

    return result.rows[0] ? mapRead(result.rows[0]) : null;
  }

  async countUnread(input: {
    threadId: string;
    userId: string;
    since: Date | null;
  }): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `
        SELECT count(*)::text AS count FROM chat_messages
        WHERE thread_id = $1
          AND sender_user_id <> $2
          AND ($3::timestamptz IS NULL OR created_at > $3::timestamptz)
      `,
      [input.threadId, input.userId, input.since]
    );

    return Number(result.rows[0]?.count ?? 0);
  }
}

function mapThread(row: ThreadRow | undefined): ChatThreadRecord {
  if (!row) {
    throw new Error("Expected chat thread row.");
  }

  return {
    id: row.id,
    matchId: row.match_id,
    creatorUserId: row.creator_user_id,
    brandUserId: row.brand_user_id,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at
  };
}

function mapMessage(row: MessageRow | undefined): ChatMessageRecord {
  if (!row) {
    throw new Error("Expected chat message row.");
  }

  const attachment: ChatAttachment | null =
    row.attachment_url && row.attachment_type
      ? { url: row.attachment_url, type: row.attachment_type }
      : null;

  return {
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    attachment,
    createdAt: row.created_at
  };
}

function mapRead(row: ReadRow | undefined): ChatThreadReadRecord {
  if (!row) {
    throw new Error("Expected chat read row.");
  }

  return {
    threadId: row.thread_id,
    userId: row.user_id,
    lastReadAt: row.last_read_at,
    updatedAt: row.updated_at
  };
}
