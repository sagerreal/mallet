#!/usr/bin/env node
/**
 * db:verify — validates that the live DB is at the same migration as the journal.
 * Exits 0 on success, 1 on divergence (with a loud message).
 *
 * Usage: node --env-file=.env.local scripts/db-verify.mjs
 * Called after every db:migrate to catch the silent-no-op gotcha.
 *
 * Drizzle's __drizzle_migrations table stores { id (serial), hash, created_at (unix ms) }.
 * The journal entry's `when` field is the same unix-ms timestamp drizzle inserts as created_at.
 * We verify by comparing the highest created_at in the DB to the last entry's `when`.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNAL_PATH = resolve(__dirname, "../shared/db/migrations/meta/_journal.json");

async function main() {
  // Also runs as the Vercel production build gate (vercel.json buildCommand), which is what stops
  // code shipping ahead of its schema — the failure that put `Failed query: select
  // "callback_number" from "users"` in front of a user.
  //
  // PREVIEW BUILDS SKIP. The database is shared dev/prod and migrations are applied by hand, one
  // branch at a time, so a feature branch whose migration is not applied yet is a NORMAL state —
  // failing those builds would block the very PR that carries the migration.
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    console.log(`db:verify skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} — production only)`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL is not set — cannot verify migrations.");
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));
  const lastEntry = journal.entries.at(-1);
  if (!lastEntry) {
    console.error("ERROR: Journal is empty — nothing to verify.");
    process.exit(1);
  }

  const db = postgres(databaseUrl, { max: 1, ssl: "require", prepare: false });
  try {
    const rows = await db`
      SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations
      ORDER BY id DESC
      LIMIT 1
    `;
    const liveWhen = rows[0]?.created_at ? Number(rows[0].created_at) : null;
    const journalWhen = lastEntry.when;

    if (liveWhen !== journalWhen) {
      console.error(
        `\nMIGRATION DIVERGENCE DETECTED!\n` +
          `  Journal last entry : ${lastEntry.tag} (when=${journalWhen})\n` +
          `  Live DB last when  : ${liveWhen ?? "(none)"}\n\n` +
          `Run \`npm run db:migrate\` to apply pending migrations, then re-run \`npm run db:verify\`.\n`,
      );
      process.exit(1);
    }
    console.log(`db:verify ✓  live DB is at ${lastEntry.tag} (when=${liveWhen})`);
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("db:verify failed unexpectedly:", err);
  process.exit(1);
});
