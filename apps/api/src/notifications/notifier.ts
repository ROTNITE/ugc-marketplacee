import { randomUUID } from "node:crypto";
import type { AuthStore } from "../auth/store.js";

/**
 * A tiny abstraction over "send the user an email/push notification".
 *
 * In development we just write to the existing email_outbox table so the
 * dev endpoint `/dev/email-outbox` keeps showing every notification.
 *
 * Swap this for SendGrid / Mailgun / FCM in production by injecting a
 * different implementation into the services.
 */
export type Notifier = {
  notifyNewChatMessage(input: {
    recipientUserId: string;
    senderUserId: string;
    threadId: string;
    preview: string;
  }): Promise<void>;
  notifyNewMatch(input: {
    recipientUserId: string;
    matchId: string;
    campaignTitle: string | null;
  }): Promise<void>;
};

export class NoopNotifier implements Notifier {
  async notifyNewChatMessage(): Promise<void> {
    /* intentionally empty */
  }
  async notifyNewMatch(): Promise<void> {
    /* intentionally empty */
  }
}

/**
 * Persists notification intents to the existing email outbox so they show
 * up in `/dev/email-outbox`. Per-user delivery rate-limiting could be added
 * here later; for now we trust the auth-layer rate limiter to keep volumes
 * sensible.
 */
export class OutboxNotifier implements Notifier {
  constructor(
    private readonly store: Pick<AuthStore, "findUserById" | "createEmailOutbox">
  ) {}

  async notifyNewChatMessage(input: {
    recipientUserId: string;
    senderUserId: string;
    threadId: string;
    preview: string;
  }): Promise<void> {
    const recipient = await this.store.findUserById(input.recipientUserId);
    if (!recipient) return;

    const trimmedPreview = input.preview.slice(0, 140);
    await this.store.createEmailOutbox({
      id: randomUUID(),
      userId: recipient.id,
      email: recipient.email,
      subject: "You have a new UGC Marketplace message",
      body: `Open the marketplace to read it: ${trimmedPreview || "(attachment)"}`,
      token: input.threadId
    });
  }

  async notifyNewMatch(input: {
    recipientUserId: string;
    matchId: string;
    campaignTitle: string | null;
  }): Promise<void> {
    const recipient = await this.store.findUserById(input.recipientUserId);
    if (!recipient) return;

    const title = input.campaignTitle ? `"${input.campaignTitle}"` : "a campaign";
    await this.store.createEmailOutbox({
      id: randomUUID(),
      userId: recipient.id,
      email: recipient.email,
      subject: "New match on UGC Marketplace",
      body: `You just matched on ${title}. Open the app to start chatting.`,
      token: input.matchId
    });
  }
}
