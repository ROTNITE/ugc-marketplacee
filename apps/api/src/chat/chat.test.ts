import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test, { beforeEach } from "node:test";
import type { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io-client";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { MemoryAuthStore } from "../auth/memory-store.test-helper.js";
import { signAccessToken } from "../auth/security.js";
import type { PublicUser, UserRole } from "../auth/types.js";
import { MemoryMarketplaceStore } from "../marketplace/memory-store.test-helper.js";
import { MemoryChatStore } from "./memory-store.test-helper.js";
import { createChatRealtimeServer } from "./realtime.js";
import { ChatService } from "./service.js";

const require = createRequire(import.meta.url);
const { io: createSocket } =
  require("socket.io-client") as typeof import("socket.io-client");

const config = loadConfig({
  ACCESS_TOKEN_TTL_SECONDS: "900",
  API_HOST: "127.0.0.1",
  API_PORT: "0",
  COOKIE_SAME_SITE: "lax",
  COOKIE_SECURE: "false",
  DATABASE_URL: "postgresql://unused",
  EMAIL_VERIFICATION_TTL_HOURS: "24",
  JWT_SECRET: "test-secret-with-enough-length",
  NODE_ENV: "test",
  REFRESH_TOKEN_TTL_DAYS: "30",
  WEB_APP_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000"
});

let authStore: MemoryAuthStore;
let marketplaceStore: MemoryMarketplaceStore;
let chatStore: MemoryChatStore;
let server: Server;
let ioServer: SocketServer;
let sockets: Socket[];
let baseUrl: string;

beforeEach(async () => {
  authStore = new MemoryAuthStore();
  marketplaceStore = new MemoryMarketplaceStore();
  chatStore = new MemoryChatStore();
  const chatService = new ChatService(chatStore, marketplaceStore);
  const app = createApp({
    config,
    authStore,
    chatService,
    marketplaceStore
  });
  server = createServer(app);
  ioServer = createChatRealtimeServer({ server, service: chatService, config });
  sockets = [];
  server.listen(0);
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected test server address.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  for (const socket of sockets) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  sockets = [];

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 500);
    ioServer.disconnectSockets(true);
    ioServer.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (server.listening) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 500);
      server.close((error) => {
        clearTimeout(timeout);
        if (error) console.error("Server close error:", error);
        resolve();
      });
    });
  }
});

test("matched users can create and list a thread while nonparticipants cannot", async () => {
  const fixture = await createMatchedFixture();
  const created = await post(
    "/chat/threads",
    { matchId: fixture.matchId },
    fixture.creator.token
  );

  assert.equal(created.status, 201);
  assert.equal(created.body.thread.thread.matchId, fixture.matchId);

  const brandThreads = await get("/chat/threads", fixture.brand.token);
  assert.equal(brandThreads.status, 200);
  assert.equal(brandThreads.body.threads.length, 1);

  const outsider = await createUser("creator");
  const blocked = await post(
    "/chat/threads",
    { matchId: fixture.matchId },
    outsider.token
  );
  assert.equal(blocked.status, 404);
});

test("messages persist, reject empty payloads, and dedupe client retries", async () => {
  const fixture = await createThreadFixture();
  const empty = await post(
    `/chat/threads/${fixture.threadId}/messages`,
    { body: " " },
    fixture.creator.token
  );
  assert.equal(empty.status, 400);

  const sent = await post(
    `/chat/threads/${fixture.threadId}/messages`,
    { body: "Hello 👋", clientMessageId: "creator-1" },
    fixture.creator.token
  );
  assert.equal(sent.status, 201);
  assert.equal(sent.body.created, true);

  const retried = await post(
    `/chat/threads/${fixture.threadId}/messages`,
    { body: "Hello 👋", clientMessageId: "creator-1" },
    fixture.creator.token
  );
  assert.equal(retried.status, 201);
  assert.equal(retried.body.created, false);
  assert.equal(retried.body.message.id, sent.body.message.id);

  const history = await get(
    `/chat/threads/${fixture.threadId}/messages`,
    fixture.brand.token
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.messages.length, 1);
  assert.equal(history.body.messages[0]?.body, "Hello 👋");

  const outsider = await createUser("brand");
  const blocked = await get(`/chat/threads/${fixture.threadId}/messages`, outsider.token);
  assert.equal(blocked.status, 404);
});

test("attachment metadata is saved and read receipts clear unread counts", async () => {
  const fixture = await createThreadFixture();
  const attachment = await post(
    `/chat/threads/${fixture.threadId}/messages`,
    {
      attachment: {
        type: "image",
        url: "https://example.com/mockup.webp"
      }
    },
    fixture.brand.token
  );
  assert.equal(attachment.status, 201);
  assert.equal(attachment.body.message.attachment.url, "https://example.com/mockup.webp");

  const beforeRead = await get("/chat/threads", fixture.creator.token);
  assert.equal(beforeRead.body.threads[0]?.unreadCount, 1);

  const read = await post(
    `/chat/threads/${fixture.threadId}/read`,
    {},
    fixture.creator.token
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.unreadCount, 0);

  const afterRead = await get("/chat/threads", fixture.creator.token);
  assert.equal(afterRead.body.threads[0]?.unreadCount, 0);

  const badAttachment = await post(
    `/chat/threads/${fixture.threadId}/messages`,
    {
      attachment: {
        type: "video",
        url: "https://example.com/file.txt"
      }
    },
    fixture.creator.token
  );
  assert.equal(badAttachment.status, 400);
});

test("socket delivery sends message, unread notification, and read events", async () => {
  const fixture = await createThreadFixture();
  const creatorSocket = await connectSocket(fixture.creator.token);
  const brandSocket = await connectSocket(fixture.brand.token);
  const outsider = await createUser("creator");
  const outsiderSocket = await connectSocket(outsider.token);

  try {
    const creatorJoin = await emitAck(creatorSocket, "thread:join", {
      threadId: fixture.threadId
    });
    assert.equal(creatorJoin.ok, true);

    const brandJoin = await emitAck(brandSocket, "thread:join", {
      threadId: fixture.threadId
    });
    assert.equal(brandJoin.ok, true);

    const blockedJoin = await emitAck(outsiderSocket, "thread:join", {
      threadId: fixture.threadId
    });
    assert.equal(blockedJoin.ok, false);
    assert.equal(blockedJoin.error?.code, "NOT_FOUND");

    const messagePromise = onceSocket(brandSocket, "message:new");
    const unreadPromise = onceSocket(brandSocket, "notification:unread");
    const sendAck = await emitAck(creatorSocket, "message:send", {
      threadId: fixture.threadId,
      body: "Realtime hello",
      clientMessageId: "socket-1"
    });
    assert.equal(sendAck.ok, true);

    const messageEvent = await messagePromise;
    assert.equal(messageEvent.message.body, "Realtime hello");
    const unreadEvent = await unreadPromise;
    assert.equal(unreadEvent.unreadCount, 1);

    const readPromise = onceSocket(creatorSocket, "thread:read");
    const readAck = await emitAck(brandSocket, "thread:read", {
      threadId: fixture.threadId
    });
    assert.equal(readAck.ok, true);

    const readEvent = await readPromise;
    assert.equal(readEvent.userId, fixture.brand.user.id);
  } finally {
    creatorSocket.disconnect();
    brandSocket.disconnect();
    outsiderSocket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

async function createThreadFixture() {
  const fixture = await createMatchedFixture();
  const created = await post(
    "/chat/threads",
    { matchId: fixture.matchId },
    fixture.creator.token
  );
  assert.equal(created.status, 201);

  return {
    ...fixture,
    threadId: created.body.thread.thread.id
  };
}

async function createMatchedFixture() {
  const creator = await createUser("creator");
  const brand = await createUser("brand");
  const campaign = await marketplaceStore.createCampaign({
    id: randomUUID(),
    ownerUserId: brand.user.id,
    title: "Launch video",
    description: "Create a short vertical UGC video.",
    categories: ["gaming"],
    budgetCents: 50000,
    deadline: new Date("2035-01-01T00:00:00.000Z"),
    mediaUrl: "https://example.com/brief.mp4",
    mediaType: "video",
    status: "active",
    language: "both",
    contentFormat: "short_video",
    targetRegions: [],
    targetPlatforms: [],
    targetInterests: [],
    targetAudienceAgeMin: null,
    targetAudienceAgeMax: null,
    minAudienceSize: null,
    maxAudienceSize: null
  });
  await marketplaceStore.upsertProfile({
    userId: creator.user.id,
    role: "creator",
    displayName: "Creator",
    avatarUrl: null,
    bio: "",
    socialLinks: {},
    niches: [],
    languages: [],
    regions: [],
    platforms: [],
    audienceSize: null,
    audienceAgeMin: null,
    audienceAgeMax: null
  });
  const { match } = await marketplaceStore.createMatch({
    id: randomUUID(),
    creatorUserId: creator.user.id,
    brandUserId: brand.user.id,
    campaignId: campaign.id
  });

  return { creator, brand, matchId: match.id };
}

async function createUser(role: UserRole): Promise<{ user: PublicUser; token: string }> {
  const user = {
    id: randomUUID(),
    email: `${role}-${randomUUID()}@example.com`,
    emailVerified: true,
    role,
    status: "active"
  } satisfies PublicUser;

  await authStore.createUser({
    id: user.id,
    email: user.email,
    passwordHash: "unused",
    role
  });
  await authStore.updateUserEmailVerified(user.id, new Date());

  return {
    user,
    token: await signAccessToken(user, config)
  };
}

async function connectSocket(token: string): Promise<Socket> {
  const socket = createSocket(baseUrl, {
    auth: { token },
    forceNew: true
  });
  sockets.push(socket);
  await onceSocket(socket, "connect");
  return socket;
}

async function emitAck(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>
): Promise<SocketAck> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: SocketAck) => resolve(response));
  });
}

async function onceSocket(socket: Socket, event: string): Promise<SocketEvent> {
  return Promise.race([
    new Promise<SocketEvent>((resolve) => {
      socket.once(event, (payload: SocketEvent) => resolve(payload));
    }),
    new Promise<SocketEvent>((_, reject) => {
      setTimeout(() => reject(new Error(`Socket event ${event} timeout`)), 5000);
    })
  ]);
}

async function get(path: string, accessToken?: string) {
  return request("GET", path, undefined, accessToken);
}

async function post(path: string, body?: unknown, accessToken?: string) {
  return request("POST", path, body, accessToken);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  accessToken?: string
): Promise<{
  status: number;
  body: TestResponseBody;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    }
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : {}
  };
}

type TestResponseBody = {
  created?: boolean;
  error?: {
    code?: string;
  };
  message: {
    id?: string;
    body?: string;
    attachment: {
      url?: string;
    };
  };
  messages: Array<{
    body?: string;
  }>;
  thread: {
    thread: {
      id: string;
      matchId: string;
    };
  };
  threads: Array<{
    unreadCount?: number;
  }>;
  unreadCount?: number;
};

type SocketAck = {
  ok?: boolean;
  error?: {
    code?: string;
  };
};

type SocketEvent = {
  message: {
    body?: string;
  };
  unreadCount?: number;
  userId?: string;
};
