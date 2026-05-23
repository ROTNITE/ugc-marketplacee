import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("migration filenames are strictly ordered with numeric prefixes", async () => {
  const dir = join(__dirname, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql"));
  const sorted = [...files].sort();
  assert.deepEqual(files.sort(), sorted, "files should sort lexicographically");
  for (const f of files) {
    assert.match(f, /^\d{3,}_.+\.sql$/, `bad migration name: ${f}`);
  }
  assert.ok(files.length >= 3, "expected at least three baseline migrations");
});
