/**
 * The comparison behind `db:verify` — pure, so it can be tested without a database.
 *
 * WHY THIS CHECKS EVERY MIGRATION, NOT JUST THE NEWEST
 *
 * The first version compared MAX(created_at) in the database against the journal's last `when` —
 * two integers. That was wrong in a way its own tests could not see: a single high-water mark
 * proves only that SOME applied migration is newer than the journal's last entry. It does not prove
 * the journal's own entries are applied. "The database is ahead" and "a migration in the middle
 * never ran" are not mutually exclusive.
 *
 * Concretely: branch A generates 0100 and never hand-applies it; branch B generates 0101 and its
 * dev does apply it; A merges first. The journal ends at 0100, live max is 0101's stamp, so a
 * high-water comparison says "ahead — pass" and ships code whose columns do not exist. That is the
 * exact outage this gate exists to prevent, and on a shared database with migrations applied BY
 * HAND from open branches it is an ordinary Tuesday, not an exotic race.
 *
 * So the check is a SUBSET test: every migration this branch carries must be present in the applied
 * set. Extra rows in the database are the genuinely-ahead ones, and are reported rather than failed.
 *
 * WHY IT FAILS IN ONLY ONE DIRECTION
 *
 * Code ahead of schema is the outage — it put `Failed query: select "callback_number" from "users"`
 * in front of a user when a deploy went out 33 minutes before its migration ran. Schema ahead of
 * code is inert: a column this branch never names cannot break a query that never selects it, and
 * migrations here are additive by convention (0100 kept `hours_wd_*` rather than dropping it for
 * exactly this reason). Since the database is shared dev/prod, "schema ahead" is the NORMAL state
 * for as long as a migration-bearing PR is in review — failing it blocked a pure-UI fix from
 * shipping and stopped every production deploy for an hour.
 *
 * WHY A GRANDFATHER LINE
 *
 * Two journal entries — 0058_futuristic_nemesis and 0059_inbound_rls — carry `when` values that
 * appear nowhere in the database, because hand-written RLS migrations get a hand-authored journal
 * entry and the stamps drifted (0058's row landed 53 seconds off, 0059's 24 minutes off). Four
 * database rows likewise match no journal entry, from the same drift. Both migrations are
 * genuinely applied: `inbound_endpoints` exists, RLS is enabled on it, `app_signup_create_org` is
 * defined.
 *
 * A subset test over the whole history would therefore fail every build forever on migrations that
 * are demonstrably live. This line freezes that pre-existing mess at a fixed timestamp instead of
 * carrying an editable allowlist: everything at or before it is trusted, everything after it — 41
 * entries today, and every migration written from here on — is checked. The constant never moves,
 * so nothing new can join the trusted set.
 */

/** 0059_inbound_rls's ACTUAL applied created_at. Frozen — never raise this to silence a failure. */
export const GRANDFATHERED_THROUGH = 1783839364002;

/** @typedef {{ tag: string, when: number }} JournalEntry */
/** @typedef {{ ok: boolean, level: "ok" | "warn" | "fail", message: string, missing: string[], aheadCount: number }} MigrationVerdict */

/**
 * @param {{ appliedWhens: readonly number[], entries: readonly JournalEntry[] }} state
 * @returns {MigrationVerdict}
 */
export function compareMigrationState({ appliedWhens, entries }) {
  if (!entries || entries.length === 0) {
    return {
      ok: false,
      level: "fail",
      missing: [],
      aheadCount: 0,
      message: "ERROR: journal is empty — nothing to verify.\n",
    };
  }

  const applied = new Set(appliedWhens ?? []);

  if (applied.size === 0) {
    return {
      ok: false,
      level: "fail",
      missing: entries.map((e) => e.tag),
      aheadCount: 0,
      message: "NO MIGRATIONS APPLIED — the database has no migration history at all.\n\nRun `npm run db:migrate`.\n",
    };
  }

  // Only entries after the frozen line are enforced; see GRANDFATHERED_THROUGH above.
  const missing = entries.filter((e) => e.when > GRANDFATHERED_THROUGH && !applied.has(e.when));

  if (missing.length > 0) {
    const list = missing.map((m) => `    ${m.tag} (when=${m.when})`).join("\n");
    return {
      ok: false,
      level: "fail",
      missing: missing.map((m) => m.tag),
      aheadCount: 0,
      message:
        "MIGRATION MISSING — the code expects a schema the database does not have.\n\n" +
        `  Not applied:\n${list}\n\n` +
        "Deploying would run queries against columns that do not exist yet, which surfaces as raw\n" +
        "SQL in the UI. Run `npm run db:migrate`, then redeploy.\n",
    };
  }

  // Newest by VALUE, not by array position: the journal is a hand-merged file, so a branch
  // generated earlier can land its entry last carrying a smaller `when`.
  const newestExpected = entries.reduce((max, e) => (e.when > max ? e.when : max), -Infinity);
  const aheadCount = [...applied].filter((w) => w > newestExpected).length;

  if (aheadCount > 0) {
    return {
      ok: true,
      level: "warn",
      missing: [],
      aheadCount,
      message:
        "db:verify ⚠  every migration this branch carries is applied, and the database holds " +
        `${aheadCount} newer one(s) this branch does not know about.\n\n` +
        "A migration from another branch is applied but not merged here. Allowed: migrations are\n" +
        "additive, so columns this code never names are inert to it. Merge the migration-bearing PR\n" +
        "to resync.\n",
    };
  }

  const last = entries[entries.length - 1];
  return {
    ok: true,
    level: "ok",
    missing: [],
    aheadCount: 0,
    message: `db:verify ✓  all ${entries.length} migrations applied (through ${last.tag})`,
  };
}
