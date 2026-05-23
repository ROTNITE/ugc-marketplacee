-- Add opt-in TOTP-based two-factor authentication.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
