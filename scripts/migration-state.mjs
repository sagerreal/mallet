/**
 * The comparison behind `db:verify` — pure, so it can be tested without a database.
 *
 * WHY THIS IS DIRECTIONAL, AND NOT AN EQUALITY CHECK
 *
 * The gate exists to stop ONE failure: code deployed ahead of its schema. That is what put
 * `Failed query: select "callback_number" from "users"` in front of a user — the deploy went out
 * 33 minutes before the migration ran, and every request in that window threw raw SQL at the UI.
 *
 * The opposite direction is NOT that failure. A database holding a column this branch has never
 * heard of is inert to it: nothing selects it, nothing writes it. Migrations here are additive by
 * convention (0100 kept `hours_wd_*` rather than dropping it for exactly this reason), so an
 * unknown column cannot break a query that does not name it.
 *
 * And because the database is shared dev/prod with migrations applied BY HAND, one branch at a
 * time, "schema ahead of code" is the NORMAL state for as long as a migration-bearing PR is in
 * review. An equality check turns that normal state into a production outage: it blocked a pure-UI
 * fix (#225) from shipping because an unrelated branch's migration (0100) was already live.
 *
 * So: behind → fail, ahead → warn, equal → pass.
 *
 * WHY MAX-TIMESTAMP AND NOT A PER-MIGRATION HASH CHECK
 *
 * Drizzle stores a sha256 of each migration file, which would be exact. It was measured against
 * the live database and THREE migrations — 0033, 0058, 0059 — have hashes that no longer match
 * their files, because the files were edited after being applied. All three are genuinely applied
 * (`inbound_endpoints` exists, RLS is on, `app_signup_create_org` is defined). A hash check would
 * therefore fail every build forever over cosmetic edits, and the only way to keep it would be a
 * hand-maintained allowlist of exceptions — a gate everyone learns to override is worse than none.
 *
 * `when` is assigned by `drizzle-kit generate` and drizzle inserts it verbatim as `created_at`, so
 * the newest applied `created_at` is directly comparable to the journal's last `when`.
 */

/** @typedef {{ ok: boolean, level: "ok" | "warn" | "fail", message: string }} MigrationVerdict */

/**
 * @param {{ liveWhen: number | null, journalWhen: number, journalTag: string }} state
 * @returns {MigrationVerdict}
 */
export function compareMigrationState({ liveWhen, journalWhen, journalTag }) {
  if (liveWhen === null) {
    return {
      ok: false,
      level: "fail",
      message:
        `NO MIGRATIONS APPLIED — the database is empty of migration history.\n` +
        `  This branch expects : ${journalTag}\n\n` +
        `Run \`npm run db:migrate\`.\n`,
    };
  }

  if (liveWhen < journalWhen) {
    return {
      ok: false,
      level: "fail",
      message:
        `MIGRATION MISSING — the code expects a schema the database does not have.\n` +
        `  This branch expects : ${journalTag} (when=${journalWhen})\n` +
        `  Live DB last applied: when=${liveWhen}\n\n` +
        `Deploying would run queries against columns that do not exist yet, which surfaces as raw\n` +
        `SQL in the UI. Run \`npm run db:migrate\`, then redeploy.\n`,
    };
  }

  if (liveWhen > journalWhen) {
    return {
      ok: true,
      level: "warn",
      message:
        `db:verify ⚠  live DB is AHEAD of this branch.\n` +
        `  This branch expects : ${journalTag} (when=${journalWhen})\n` +
        `  Live DB last applied: when=${liveWhen}\n\n` +
        `A migration from another branch is applied but not merged here. Allowed: migrations are\n` +
        `additive, so columns this code never names are inert to it. Merge the migration-bearing PR\n` +
        `to resync.\n`,
    };
  }

  return { ok: true, level: "ok", message: `db:verify ✓  live DB is at ${journalTag} (when=${liveWhen})` };
}
