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

// Track if database is available
let dbAvailable = false;

// Gracefully handle missing database — log warning instead of crashing.
// Useful for CI, v0.dev preview, and local dev without PostgreSQL.
if (pool) {
  try {
    await initializeAuthSchema(pool);
    dbAvailable = true;
    console.log("Database connected and schema initialized.");
  } catch (error) {
    console.warn(
      "WARNING: Could not connect to database. The API will run in degraded mode.",
      (error as Error).message,
    );
  }
} else {
  console.warn("WARNING: DATABASE_URL not set. Running API without database.");
}

// Create stores - they will handle null pool gracefully
const authStore = pool ? new PgAuthStore(pool) : null;
const notifier = authStore ? new OutboxNotifier(authStore) : null;
const marketplaceStore = pool ? new PgMarketplaceStore(pool) : null;
const chatStore = pool ? new PgChatStore(pool) : null;
const chatService = chatStore && marketplaceStore && notifier 
  ? new ChatService(chatStore, marketplaceStore, notifier) 
  : null;
const rewardsStore = pool ? new PostgresRewardsStore(pool) : null;
const rewardsService = rewardsStore ? new RewardsService(rewardsStore, config) : null;

// PaymentService needs Stripe — gracefully skip if not configured
let paymentService: PaymentService | null = null;
if (pool && marketplaceStore && rewardsService && config.stripeSecretKey) {
  try {
    paymentService = new PaymentService(
      new PostgresPaymentStore(pool),
      marketplaceStore,
      config,
      rewardsService,
    );
    console.log("Stripe payment service initialized.");
  } catch (error) {
    console.warn("WARNING: PaymentService not available.", (error as Error).message);
  }
} else if (!config.stripeSecretKey) {
  console.warn("WARNING: STRIPE_SECRET_KEY not set. Payment features disabled.");
}

const moderationService = pool && authStore && marketplaceStore && chatStore
  ? new ModerationService(
      new PostgresModerationStore(pool),
      authStore,
      marketplaceStore,
      chatStore,
    )
  : null;

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

const server = createServer(app);

if (chatService) {
  createChatRealtimeServer({ server, service: chatService, config });
}

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
  if (!dbAvailable) {
    console.log("  Mode: Degraded (no database)");
  }
  if (!paymentService) {
    console.log("  Stripe: Disabled");
  }
});
