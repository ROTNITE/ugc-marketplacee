import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import type { ApiConfig } from "../config.js";
import { AuthError } from "../auth/errors.js";
import { verifyAccessToken, type AccessTokenClaims } from "../auth/security.js";
import type { ChatService } from "./service.js";

type ChatSocket = Socket & {
  data: {
    auth: AccessTokenClaims;
  };
};

type Ack = (payload: unknown) => void;

export function createChatRealtimeServer(options: {
  server: HttpServer;
  service: ChatService;
  config: Pick<ApiConfig, "jwtSecret" | "webOrigin">;
}): SocketServer {
  const io = new SocketServer(options.server, {
    cors: {
      credentials: true,
      origin: options.config.webOrigin
    }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (typeof token !== "string" || !token) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    try {
      socket.data.auth = await verifyAccessToken(token, options.config);
      socket.join(userRoom(socket.data.auth.sub));
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const chatSocket = socket as ChatSocket;

    chatSocket.on(
      "thread:join",
      async (payload: { threadId?: unknown }, acknowledge?: Ack) => {
        await withAck(acknowledge, async () => {
          const threadId = requireString(payload?.threadId);
          const thread = await options.service.getAuthorizedThread(
            chatSocket.data.auth,
            threadId
          );
          await chatSocket.join(threadRoom(thread.id));
          return { ok: true, threadId: thread.id };
        });
      }
    );

    chatSocket.on("message:send", async (payload: unknown, acknowledge?: Ack) => {
      await withAck(acknowledge, async () => {
        const record = requireRecord(payload);
        const threadId = requireString(record.threadId);
        const result = await options.service.sendMessage(
          chatSocket.data.auth,
          threadId,
          record
        );

        io.to(threadRoom(threadId)).emit("message:new", {
          message: result.message,
          thread: result.thread
        });
        io.to(userRoom(result.recipientUserId)).emit("notification:unread", {
          threadId,
          unreadCount: result.recipientUnreadCount
        });

        return { ok: true, ...result };
      });
    });

    chatSocket.on(
      "thread:read",
      async (payload: { threadId?: unknown }, acknowledge?: Ack) => {
        await withAck(acknowledge, async () => {
          const threadId = requireString(payload?.threadId);
          const result = await options.service.markRead(chatSocket.data.auth, threadId);

          io.to(threadRoom(threadId)).emit("thread:read", result);
          return { ok: true, ...result };
        });
      }
    );
  });

  return io;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function threadRoom(threadId: string): string {
  return `thread:${threadId}`;
}

async function withAck(acknowledge: Ack | undefined, operation: () => Promise<unknown>) {
  try {
    const result = await operation();
    acknowledge?.(result);
  } catch (error) {
    const payload = {
      ok: false,
      error: {
        code: error instanceof AuthError ? error.code : "REQUEST_FAILED"
      }
    };
    acknowledge?.(payload);
  }
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400);
  }

  return value.trim();
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthError("INVALID_PAYLOAD", "Request payload is invalid.", 400);
  }

  return value as Record<string, unknown>;
}
