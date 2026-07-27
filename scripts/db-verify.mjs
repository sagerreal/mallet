#!/usr/bin/env node
/**
 * db:verify — validates that the live DB is not BEHIND the migrations this branch carries.
 * Exits 0 on success (including when the DB is ahead), 1 when a migration is missing.
 *
 * Usage: node --env-file=.env.local scripts/db-verify.mjs
 * Called after every db:migrate to catch the silent-no-op gotcha.
 *
 * Drizzle's __drizzle_migrations table stores { id (serial), hash, created_at (unix ms) }.
 * The journal entry's `when` field is the same unix-ms timestamp drizzle inserts as created_at.
 * We compare the highest created_at in the DB to the last entry's `when`.
 *
 * The comparison itself lives in ./migration-state.mjs, which documents why it is directional
 * rather than an equality check. Read that before tightening this.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { compareMigrationState } from "./migration-state.mjs";

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
  const entries = journal.entries ?? [];

  const db = postgres(databaseUrl, { max: 1, ssl: "require", prepare: false });
  try {
    // The WHOLE applied set, not just the newest row. A high-water mark cannot tell "the database
    // is ahead" apart from "the database is ahead AND a migration in the middle never ran" — see
    // migration-state.mjs. ~100 integers; the cost is nothing and the distinction is the gate.
    const rows = await db`SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations`;
    const appliedWhens = rows
      .map((r) => Number(r.created_at))
      .filter((n) => Number.isFinite(n));

    const verdict = compareMigrationState({ appliedWhens, entries });

    if (!verdict.ok) {
      console.error(`\n${verdict.message}`);
      process.exit(1);
    }
    // A warning still passes, but goes to stderr so it is visible in a build log rather than
    // buried among the lines nobody reads when the build is green.
    if (verdict.level === "warn") console.error(`\n${verdict.message}`);
    else console.log(verdict.message);
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("db:verify failed unexpectedly:", err);
  process.exit(1);
});
