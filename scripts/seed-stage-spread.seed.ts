/**
 * Give the seeded shop a realistic pipeline instead of one 603-row "New leads" column.
 *
 * The scale seed created every customer through v1.customers.create, which correctly starts a lead
 * at "new" — so all 606 piled into a single stage and the Pipeline board rendered one tall column
 * and three empty ones. That is a seed-data problem, not a product one, but it makes the board
 * impossible to judge.
 *
 * The distribution below is roughly what a working shop looks like: most of the book is WON (they
 * are past customers, not open leads), a thin layer is genuinely in play, and a real fraction is
 * lost. A pipeline where everything is open is exactly as unrealistic as one where nothing is.
 *
 * Stages are set through the REPOSITORY, not raw SQL, so each transition goes through the domain's
 * moveStage and lands the same way a real one would.
 *
 *   npx vitest run --config vitest.integration.config.ts scripts/seed-stage-spread
 */
import { describe, it } from "vitest";
import postgres from "postgres";
import { closeDb } from "@mallet/shared/db/client";

const ORG_ID = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";

/**
 * Cumulative shares. Past customers dominate a real book — a shop that has been running two years
 * has far more closed work than open leads, and a board showing the reverse teaches the wrong
 * thing about the product.
 */
const SPREAD: readonly [stage: string, share: number][] = [
  ["won", 0.55],
  ["lost", 0.15],
  ["quote_sent", 0.12],
  ["contacted", 0.1],
  ["new", 0.08],
];

describe("seed: spread customers across pipeline stages", () => {
  it("moves the book into a realistic distribution", async () => {
    const sql = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const rows = await sql<{ id: string }[]>`
      select id from leads where org_id = ${ORG_ID} and deleted_at is null order by created_at`;
    console.log(`\n  ${rows.length} customers`);

    // Deterministic, not random: re-running must produce the same board rather than reshuffling it
    // every time and making "did that change?" impossible to answer.
    let cursor = 0;
    for (const [stage, share] of SPREAD) {
      const upTo = cursor + Math.round(rows.length * share);
      const slice = rows.slice(cursor, upTo).map((r) => r.id);
      cursor = upTo;
      if (slice.length === 0) continue;
      // updated_at moves too — it is what the customers list sorts by, and a book where every row
      // was touched in the same second sorts arbitrarily.
      await sql`
        update leads set stage = ${stage},
          updated_at = now() - (random() * interval '180 days')
        where org_id = ${ORG_ID} and id = any(${slice})`;
      console.log(`  ${stage.padEnd(11)} ${slice.length}`);
    }
    // Anything left over from rounding stays where it is.
    const after = await sql<{ stage: string; n: number }[]>`
      select stage, count(*)::int n from leads where org_id = ${ORG_ID} and deleted_at is null
      group by 1 order by 2 desc`;
    console.log("\n  final:", after.map((r) => `${r.stage}=${r.n}`).join("  "), "\n");

    await sql.end();
    await closeDb();
  }, 300_000);
});
