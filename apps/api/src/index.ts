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
await initializeAuthSchema(pool);
const authStore = new PgAuthStore(pool);
const notifier = new OutboxNotifier(authStore);
const marketplaceStore = new PgMarketplaceStore(pool);
const chatStore = new PgChatStore(pool);
const chatService = new ChatService(chatStore, marketplaceStore, notifier);
const rewardsService = new RewardsService(new PostgresRewardsStore(pool), config);
const paymentStore = new PostgresPaymentStore(pool);
const paymentService = new PaymentService(
  paymentStore,
  marketplaceStore,
  config,
  rewardsService
);
const moderationService = new ModerationService(
  new PostgresModerationStore(pool),
  authStore,
  marketplaceStore,
  chatStore
);
const app = createApp({
  config,
  authStore,
  chatService,
  marketplaceStore,
  paymentService,
  rewardsService,
  moderationService,
  notifier
});
const server = createServer(app);
createChatRealtimeServer({ server, service: chatService, config });

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});
