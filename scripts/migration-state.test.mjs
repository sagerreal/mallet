import { describe, expect, it } from "vitest";
import { compareMigrationState, GRANDFATHERED_THROUGH } from "./migration-state.mjs";

// Real timestamps from the outage this gate exists for. All are past GRANDFATHERED_THROUGH, so
// they are enforced rather than trusted.
const W_0099 = 1785092079725;
const W_0100 = 1785110514967;
const W_0101 = 1785200000000;

const entry = (tag, when) => ({ tag, when });

describe("compareMigrationState", () => {
  it("passes when the database holds a migration this branch has not merged", () => {
    // The case that took production down: 0100 was applied while its PR was open, so main's
    // journal stopped at 0099. Nothing main deploys reads the new columns.
    const v = compareMigrationState({
      appliedWhens: [W_0099, W_0100],
      entries: [entry("0099_slim_crystal", W_0099)],
    });

    expect(v.ok).toBe(true);
    expect(v.level).toBe("warn");
    expect(v.aheadCount).toBe(1);
  });

  it("FAILS when a migration is missing even though the database looks ahead", () => {
    // The hole a high-water-mark comparison cannot see, and the reason this takes the whole set.
    // Branch A generated 0100 and never applied it; branch B generated 0101 and did. A merges
    // first. MAX(created_at) is 0101 — newer than the journal's last entry — so a max-based check
    // reads "ahead, pass" and ships code whose columns do not exist.
    const v = compareMigrationState({
      appliedWhens: [W_0099, W_0101],
      entries: [entry("0099_slim_crystal", W_0099), entry("0100_milky_zarek", W_0100)],
    });

    expect(v.ok).toBe(false);
    expect(v.level).toBe("fail");
    expect(v.missing).toEqual(["0100_milky_zarek"]);
  });

  it("names every missing migration, so the build log says exactly what to apply", () => {
    const v = compareMigrationState({
      appliedWhens: [W_0099],
      entries: [
        entry("0099_slim_crystal", W_0099),
        entry("0100_milky_zarek", W_0100),
        entry("0101_later", W_0101),
      ],
    });

    expect(v.missing).toEqual(["0100_milky_zarek", "0101_later"]);
    expect(v.message).toContain("0100_milky_zarek");
    expect(v.message).toContain("0101_later");
    expect(v.message).toContain("db:migrate");
  });

  it("trusts entries at or before the grandfather line", () => {
    // 0058/0059 carry `when` values that appear nowhere in the database — hand-authored RLS
    // journal entries whose stamps drifted. Both are genuinely applied. Enforcing them would fail
    // every build forever.
    const v = compareMigrationState({
      appliedWhens: [W_0099],
      entries: [
        entry("0059_inbound_rls", GRANDFATHERED_THROUGH),
        entry("0058_futuristic_nemesis", GRANDFATHERED_THROUGH - 1000),
        entry("0099_slim_crystal", W_0099),
      ],
    });

    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("enforces the very first entry after the grandfather line", () => {
    // The boundary is strictly-greater-than, so one millisecond past the line is checked. If this
    // ever flips to >=, an unapplied migration would be trusted.
    const v = compareMigrationState({
      appliedWhens: [W_0099],
      entries: [entry("0060_just_after", GRANDFATHERED_THROUGH + 1), entry("0099_slim_crystal", W_0099)],
    });

    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["0060_just_after"]);
  });

  it("finds the newest entry by value, not by array position", () => {
    // The journal is a hand-merged file: a branch generated earlier can land its entry LAST while
    // carrying a smaller `when`. Reading entries.at(-1) would compare against the wrong migration.
    const v = compareMigrationState({
      appliedWhens: [W_0099, W_0100, W_0101],
      entries: [entry("0100_milky_zarek", W_0100), entry("0099_slim_crystal", W_0099)],
    });

    expect(v.ok).toBe(true);
    expect(v.level).toBe("warn");
    expect(v.aheadCount).toBe(1); // only 0101 is ahead — not 0100, despite it sitting first
  });

  it("passes silently when everything the branch carries is applied and nothing is newer", () => {
    const v = compareMigrationState({
      appliedWhens: [W_0099, W_0100],
      entries: [entry("0099_slim_crystal", W_0099), entry("0100_milky_zarek", W_0100)],
    });

    expect(v.ok).toBe(true);
    expect(v.level).toBe("ok");
    expect(v.aheadCount).toBe(0);
  });

  it("fails on an empty migration history rather than reading it as in sync", () => {
    const v = compareMigrationState({
      appliedWhens: [],
      entries: [entry("0099_slim_crystal", W_0099)],
    });

    expect(v.ok).toBe(false);
    expect(v.message).toContain("NO MIGRATIONS APPLIED");
  });

  it("fails on an empty journal rather than passing vacuously", () => {
    const v = compareMigrationState({ appliedWhens: [W_0099], entries: [] });

    expect(v.ok).toBe(false);
  });
});
