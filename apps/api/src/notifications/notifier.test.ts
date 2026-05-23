import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryAuthStore } from "../auth/memory-store.test-helper.js";
import { OutboxNotifier } from "./notifier.js";

test("OutboxNotifier writes a chat-message notification with truncated preview", async () => {
  const store = new MemoryAuthStore();
  const user = await store.createUser({
    id: randomUUID(),
    email: "alice@example.com",
    passwordHash: "x",
    role: "creator",
    dateOfBirth: null
  });

  const notifier = new OutboxNotifier(store);
  await notifier.notifyNewChatMessage({
    recipientUserId: user.id,
    senderUserId: randomUUID(),
    threadId: "thread-1",
    preview: "x".repeat(500)
  });

  assert.equal(store.emailOutbox.length, 1);
  const entry = store.emailOutbox[0];
  assert.ok(entry);
  assert.equal(entry.email, "alice@example.com");
  assert.match(entry.subject, /new UGC Marketplace message/);
  assert.ok(entry.body.length < 220, "preview should be truncated");
});

test("OutboxNotifier silently skips when user does not exist", async () => {
  const store = new MemoryAuthStore();
  const notifier = new OutboxNotifier(store);
  await notifier.notifyNewMatch({
    recipientUserId: "00000000-0000-0000-0000-000000000000",
    matchId: "match-1",
    campaignTitle: "Cool campaign"
  });
  assert.equal(store.emailOutbox.length, 0);
});

test("OutboxNotifier notifies both sides of a new match with campaign title", async () => {
  const store = new MemoryAuthStore();
  const recipient = await store.createUser({
    id: randomUUID(),
    email: "bob@example.com",
    passwordHash: "x",
    role: "brand",
    dateOfBirth: null
  });
  const notifier = new OutboxNotifier(store);
  await notifier.notifyNewMatch({
    recipientUserId: recipient.id,
    matchId: "m-1",
    campaignTitle: "Pizza promo"
  });
  assert.equal(store.emailOutbox.length, 1);
  assert.match(store.emailOutbox[0]!.body, /Pizza promo/);
  assert.match(store.emailOutbox[0]!.subject, /New match/);
});
