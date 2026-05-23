-- Baseline migration: marks the existing initializeAuthSchema() result as v1.
-- This file intentionally has no DDL because the legacy bootstrap function
-- already created/altered everything idempotently. New schema changes from
-- this point forward MUST be added as new numbered migration files
-- (002_*, 003_*, ...) so we have a clean linear history.
SELECT 1;
