import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, initializeAuthSchema } from "./db.js";
import { PgAuthStore } from "./auth/pg-store.js";
import { PgChatStore } from "./chat/pg-store.js";
import { createChatRealtimeServer } from "./chat/realtime.js";
import { ChatService } from "./chat/service.js";
import { PgMarketplaceStore } from "./marketplace/pg-store.js";
import { PostgresPaymentStore } from "./payments/store.js";
import { PaymentService } from "./payments/service.js";
import { PostgresRewardsStore } from "./rewards/store.js";
import { RewardsService } from "./rewards/service.js";
import { PostgresModerationStore } from "./moderation/store.js";
import { ModerationService } from "./moderation/service.js";
import { OutboxNotifier } from "./notifications/notifier.js";

const config = loadConfig();
const pool = createPool(config);

// Gracefully handle missing database — log warning instead of crashing.
// Useful for CI, v0.dev preview, and local dev without PostgreSQL.
try {
  await initializeAuthSchema(pool);
} catch (error) {
  console.warn(
    "WARNING: Could not connect to database. The API will not serve DB-backed routes.",
    (error as Error).message,
  );
}

const authStore = new PgAuthStore(pool);
const notifier = new OutboxNotifier(authStore);
const marketplaceStore = new PgMarketplaceStore(pool);
const chatStore = new PgChatStore(pool);
const chatService = new ChatService(chatStore, marketplaceStore, notifier);
const rewardsService = new RewardsService(new PostgresRewardsStore(pool), config);

// PaymentService needs Stripe — gracefully skip if not configured
let paymentService: PaymentService | undefined;
try {
  paymentService = new PaymentService(
    new PostgresPaymentStore(pool),
    marketplaceStore,
    config,
    rewardsService,
  );
} catch (error) {
  console.warn("WARNING: PaymentService not available.", (error as Error).message);
}

const moderationService = new ModerationService(
  new PostgresModerationStore(pool),
  authStore,
  marketplaceStore,
  chatStore,
);
const app = createApp({
  config,
  authStore,
  chatService,
  marketplaceStore,
  paymentService,
  rewardsService,
  moderationService,
  notifier,
});

// ⚠️ ЭТА СТРОКА БЫЛА ПРОПУЩЕНА!
const server = createServer(app);
createChatRealtimeServer({ server, service: chatService, config });

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});