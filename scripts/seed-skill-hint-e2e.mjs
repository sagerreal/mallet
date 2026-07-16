/**
 * scripts/seed-skill-hint-e2e.mjs
 * T5 screenshot seed script — sets required_certs on an E2E job and records the job ID.
 * Uses the DATABASE_URL (postgres owner role) from .env.local, same as the int tests.
 * Cleans up: resets required_certs back to null when called with --cleanup.
 *
 * Usage:
 *   node scripts/seed-skill-hint-e2e.mjs          # seed
 *   node scripts/seed-skill-hint-e2e.mjs --cleanup # reset
 */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load DATABASE_URL from .env.local
const envPath = join(__dir, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const DATABASE_URL = env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}

const cleanup = process.argv.includes("--cleanup");
const seedFile = join(__dir, "../.e2e-skill-hint-seed.json");

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  if (cleanup) {
    // Read the job ID written during seed
    let seed;
    try {
      seed = JSON.parse(readFileSync(seedFile, "utf8"));
    } catch {
      console.log("No seed file found — nothing to clean up.");
      process.exit(0);
    }
    await sql`UPDATE jobs SET required_certs = NULL WHERE id = ${seed.jobId}`;
    console.log(`Cleaned up required_certs for job ${seed.jobId}`);
  } else {
    // Find a job in the E2E Plumbing org (fixture org used in e2e tests)
    // that has at least one visit so the banner can render.
    const [row] = await sql`
      SELECT j.id, j.title, o.name as org_name
      FROM jobs j
      JOIN orgs o ON o.id = j.org_id
      WHERE o.name ILIKE '%e2e%'
        AND j.deleted_at IS NULL
      LIMIT 1
    `;
    if (!row) {
      console.error("No E2E org job found — run the golden path E2E first to create a job.");
      process.exit(1);
    }
    await sql`
      UPDATE jobs
      SET required_certs = ARRAY['Backflow']
      WHERE id = ${row.id}
    `;
    console.log(`Set required_certs=['Backflow'] on job "${row.title}" (${row.id}) in org "${row.org_name}"`);
    writeFileSync(seedFile, JSON.stringify({ jobId: row.id }));
  }
} finally {
  await sql.end();
}
