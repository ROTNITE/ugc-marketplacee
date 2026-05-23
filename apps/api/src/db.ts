import pg from "pg";
import type { ApiConfig } from "./config.js";

export function createPool(config: Pick<ApiConfig, "databaseUrl">): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl
  });
}

export async function initializeAuthSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      email_verified_at timestamptz,
      role text NOT NULL CHECK (role IN ('creator', 'brand', 'admin')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      replaced_by_session_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS refresh_sessions_user_id_idx
      ON refresh_sessions(user_id);

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx
      ON email_verification_tokens(user_id);

    CREATE TABLE IF NOT EXISTS email_outbox (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      token text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('creator', 'brand')),
      display_name text NOT NULL,
      avatar_url text,
      bio text NOT NULL DEFAULT '',
      social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
      niches text[] NOT NULL DEFAULT '{}',
      languages text[] NOT NULL DEFAULT '{}',
      regions text[] NOT NULL DEFAULT '{}',
      platforms text[] NOT NULL DEFAULT '{}',
      audience_size integer CHECK (audience_size IS NULL OR audience_size >= 0),
      audience_age_min integer CHECK (audience_age_min IS NULL OR audience_age_min BETWEEN 1 AND 120),
      audience_age_max integer CHECK (audience_age_max IS NULL OR audience_age_max BETWEEN 1 AND 120),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id uuid PRIMARY KEY,
      owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text NOT NULL,
      categories text[] NOT NULL,
      budget_cents integer NOT NULL CHECK (budget_cents > 0),
      deadline timestamptz NOT NULL,
      media_url text NOT NULL,
      media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
      status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived', 'rejected')),
      moderation_reason text,
      language text NOT NULL DEFAULT 'both' CHECK (language IN ('ru', 'en', 'both')),
      content_format text NOT NULL DEFAULT 'short_video' CHECK (content_format IN ('short_video', 'long_video', 'review', 'demo')),
      target_regions text[] NOT NULL DEFAULT '{}',
      target_platforms text[] NOT NULL DEFAULT '{}',
      target_interests text[] NOT NULL DEFAULT '{}',
      target_audience_age_min integer CHECK (target_audience_age_min IS NULL OR target_audience_age_min BETWEEN 1 AND 120),
      target_audience_age_max integer CHECK (target_audience_age_max IS NULL OR target_audience_age_max BETWEEN 1 AND 120),
      min_audience_size integer CHECK (min_audience_size IS NULL OR min_audience_size >= 0),
      max_audience_size integer CHECK (max_audience_size IS NULL OR max_audience_size >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS niches text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS regions text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS platforms text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS audience_size integer,
      ADD COLUMN IF NOT EXISTS audience_age_min integer,
      ADD COLUMN IF NOT EXISTS audience_age_max integer;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('creator', 'brand', 'admin'));
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE users ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'banned'));

    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'both',
      ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'short_video',
      ADD COLUMN IF NOT EXISTS target_regions text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS target_platforms text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS target_interests text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS target_audience_age_min integer,
      ADD COLUMN IF NOT EXISTS target_audience_age_max integer,
      ADD COLUMN IF NOT EXISTS min_audience_size integer,
      ADD COLUMN IF NOT EXISTS max_audience_size integer,
      ADD COLUMN IF NOT EXISTS moderation_reason text;

    ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'archived', 'rejected'));

    CREATE INDEX IF NOT EXISTS campaigns_owner_user_id_idx
      ON campaigns(owner_user_id);

    CREATE INDEX IF NOT EXISTS campaigns_feed_idx
      ON campaigns(status, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS swipe_interactions (
      id uuid PRIMARY KEY,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type text NOT NULL CHECK (target_type IN ('campaign', 'profile')),
      target_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('like', 'dislike', 'save')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (actor_user_id, target_type, target_id, action)
    );

    CREATE INDEX IF NOT EXISTS swipe_interactions_actor_target_idx
      ON swipe_interactions(actor_user_id, target_type, target_id);

    CREATE TABLE IF NOT EXISTS matches (
      id uuid PRIMARY KEY,
      creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'archived')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (creator_user_id, brand_user_id, campaign_id)
    );

    CREATE INDEX IF NOT EXISTS matches_creator_user_id_idx
      ON matches(creator_user_id);

    CREATE INDEX IF NOT EXISTS matches_brand_user_id_idx
      ON matches(brand_user_id);

    CREATE TABLE IF NOT EXISTS chat_threads (
      id uuid PRIMARY KEY,
      match_id uuid NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
      creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz
    );

    CREATE INDEX IF NOT EXISTS chat_threads_creator_user_id_idx
      ON chat_threads(creator_user_id);

    CREATE INDEX IF NOT EXISTS chat_threads_brand_user_id_idx
      ON chat_threads(brand_user_id);

    CREATE INDEX IF NOT EXISTS chat_threads_last_message_at_idx
      ON chat_threads(last_message_at DESC NULLS LAST, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id uuid PRIMARY KEY,
      thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_message_id text,
      body text NOT NULL DEFAULT '',
      attachment_url text,
      attachment_type text CHECK (attachment_type IN ('image', 'video')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (thread_id, sender_user_id, client_message_id)
    );

    CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
      ON chat_messages(thread_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS chat_thread_reads (
      thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (thread_id, user_id)
    );

    -- Payment system tables
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      pending_cents integer NOT NULL DEFAULT 0 CHECK (pending_cents >= 0),
      total_earned_cents integer NOT NULL DEFAULT 0 CHECK (total_earned_cents >= 0),
      total_withdrawn_cents integer NOT NULL DEFAULT 0 CHECK (total_withdrawn_cents >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL CHECK (type IN ('deposit', 'escrow_hold', 'escrow_release', 'payout', 'refund', 'commission')),
      amount_cents integer NOT NULL,
      currency text NOT NULL DEFAULT 'RUB',
      status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
      stripe_payment_intent_id text,
      stripe_payout_id text,
      related_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
      related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS transactions_user_id_idx
      ON transactions(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS transactions_stripe_payment_intent_idx
      ON transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS escrow_holds (
      id uuid PRIMARY KEY,
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
      brand_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      amount_cents integer NOT NULL CHECK (amount_cents > 0),
      commission_cents integer NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
      status text NOT NULL CHECK (status IN ('held', 'released', 'refunded')),
      deposit_transaction_id uuid NOT NULL REFERENCES transactions(id),
      release_transaction_id uuid REFERENCES transactions(id),
      released_at timestamptz,
      refunded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS escrow_holds_campaign_id_idx
      ON escrow_holds(campaign_id);

    CREATE INDEX IF NOT EXISTS escrow_holds_match_id_idx
      ON escrow_holds(match_id) WHERE match_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS escrow_holds_status_idx
      ON escrow_holds(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS match_deliverables (
      id uuid PRIMARY KEY,
      match_id uuid NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
      creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url text NOT NULL,
      note text NOT NULL DEFAULT '',
      status text NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS match_deliverables_creator_user_id_idx
      ON match_deliverables(creator_user_id);

    CREATE INDEX IF NOT EXISTS match_deliverables_brand_user_id_idx
      ON match_deliverables(brand_user_id);

    CREATE TABLE IF NOT EXISTS platform_fees (
      id uuid PRIMARY KEY,
      transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      amount_cents integer NOT NULL CHECK (amount_cents > 0),
      fee_type text NOT NULL CHECK (fee_type IN ('commission', 'processing')),
      rate_percent numeric(5,2) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS platform_fees_transaction_id_idx
      ON platform_fees(transaction_id);

    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id uuid PRIMARY KEY,
      referrer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code text NOT NULL,
      reward_credits integer NOT NULL CHECK (reward_credits > 0),
      rewarded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reward_ledger (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL CHECK (type IN ('referral_bonus', 'credit_spent', 'manual_adjustment')),
      amount_credits integer NOT NULL,
      related_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS reward_ledger_user_created_idx
      ON reward_ledger(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_badges (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_key text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      earned_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, badge_key)
    );

    CREATE TABLE IF NOT EXISTS user_gamification_progress (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
      level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
      current_streak integer NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
      longest_streak integer NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
      last_activity_date date,
      reputation_score integer NOT NULL DEFAULT 0 CHECK (reputation_score >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS gamification_events (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type text NOT NULL CHECK (event_type IN (
        'profile_completed',
        'campaign_posted',
        'swipe_action',
        'match_created',
        'escrow_funded',
        'campaign_completed'
      )),
      xp_delta integer NOT NULL DEFAULT 0,
      reputation_delta integer NOT NULL DEFAULT 0,
      related_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
      related_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
      idempotency_key text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      activity_date date NOT NULL DEFAULT CURRENT_DATE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS gamification_events_user_idempotency_idx
      ON gamification_events(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS gamification_events_user_created_idx
      ON gamification_events(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS user_gamification_progress_leaderboard_idx
      ON user_gamification_progress(reputation_score DESC, xp DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS moderation_reports (
      id uuid PRIMARY KEY,
      reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type text NOT NULL CHECK (target_type IN ('campaign', 'profile', 'chat_message')),
      target_id uuid NOT NULL,
      reason text NOT NULL,
      details text NOT NULL DEFAULT '',
      status text NOT NULL CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
      resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      admin_note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS moderation_reports_status_created_idx
      ON moderation_reports(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id uuid PRIMARY KEY,
      admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type text NOT NULL,
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      report_id uuid REFERENCES moderation_reports(id) ON DELETE SET NULL,
      note text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS moderation_actions_created_idx
      ON moderation_actions(created_at DESC);

    CREATE TABLE IF NOT EXISTS recommendation_events (
      id uuid PRIMARY KEY,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feed_type text NOT NULL CHECK (feed_type IN ('campaigns', 'creators')),
      target_type text NOT NULL CHECK (target_type IN ('campaign', 'profile')),
      target_id uuid NOT NULL,
      score numeric(8,2) NOT NULL,
      rank integer NOT NULL CHECK (rank > 0),
      reasons text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS recommendation_events_actor_created_idx
      ON recommendation_events(actor_user_id, created_at DESC);
  `);
}
