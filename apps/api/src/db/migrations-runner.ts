import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { logger } from "../observability/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Migrations live next to the compiled file in dist/db/migrations, but
// also next to the source in src/db/migrations during dev. We try both.
const candidateDirs = [
  resolve(__dirname, "migrations"),
  resolve(__dirname, "..", "..", "src", "db", "migrations")
];

/**
 * Lightweight forward-only migration runner.
 *
 * Reads .sql files in `db/migrations/` ordered by filename. Each file is
 * executed inside a single transaction and recorded in `schema_migrations`.
 * Already-applied filenames are skipped.
 *
 * This is intentionally tiny - no rollbacks, no checksum verification.
 * It's enough to stop relying on `ADD COLUMN IF NOT EXISTS` for every
 * future schema change and gives the team a real audit trail.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const dir = await findMigrationsDir();
  if (!dir) {
    logger.warn("no migrations directory found, skipping");
    return;
  }

  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();

  const applied = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  const appliedSet = new Set(applied.rows.map((row) => row.filename));

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ file }, "applied migration");
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error({ err: error, file }, "migration failed");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findMigrationsDir(): Promise<string | null> {
  for (const candidate of candidateDirs) {
    try {
      const entries = await readdir(candidate);
      if (entries.some((entry) => entry.endsWith(".sql"))) {
        return candidate;
      }
    } catch {
      /* directory missing, try next */
    }
  }
  return null;
}
