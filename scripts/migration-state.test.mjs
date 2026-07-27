import { describe, expect, it } from "vitest";
import { compareMigrationState } from "./migration-state.mjs";

// The real numbers from the outage this fix exists for: 0100 was applied to the shared database
// while its PR was still open, main's journal stopped at 0099, and every production deploy failed.
const JOURNAL_0099 = 1785092079725;
const LIVE_0100 = 1785110514967;

describe("compareMigrationState", () => {
  it("passes when the database is ahead of the branch — the case that broke production", () => {
    const v = compareMigrationState({
      liveWhen: LIVE_0100,
      journalWhen: JOURNAL_0099,
      journalTag: "0099_slim_crystal",
    });

    // The whole point. An unrelated branch's applied migration must not block a deploy that
    // does not depend on it.
    expect(v.ok).toBe(true);
    expect(v.level).toBe("warn");
  });

  it("fails when the branch carries a migration the database has not run", () => {
    const v = compareMigrationState({
      liveWhen: JOURNAL_0099,
      journalWhen: LIVE_0100,
      journalTag: "0100_milky_zarek",
    });

    expect(v.ok).toBe(false);
    expect(v.level).toBe("fail");
  });

  it("names the migration the branch expects, so the fix is obvious from the build log", () => {
    const v = compareMigrationState({
      liveWhen: JOURNAL_0099,
      journalWhen: LIVE_0100,
      journalTag: "0100_milky_zarek",
    });

    expect(v.message).toContain("0100_milky_zarek");
    expect(v.message).toContain("db:migrate");
  });

  it("passes silently when the two are in sync", () => {
    const v = compareMigrationState({
      liveWhen: LIVE_0100,
      journalWhen: LIVE_0100,
      journalTag: "0100_milky_zarek",
    });

    expect(v.ok).toBe(true);
    expect(v.level).toBe("ok");
  });

  it("fails on an empty migration history rather than reading it as in sync", () => {
    // null must not compare as 0-and-therefore-behind by accident, nor pass as equal.
    const v = compareMigrationState({
      liveWhen: null,
      journalWhen: JOURNAL_0099,
      journalTag: "0099_slim_crystal",
    });

    expect(v.ok).toBe(false);
    expect(v.level).toBe("fail");
    expect(v.message).toContain("NO MIGRATIONS APPLIED");
  });

  it("treats one millisecond behind as behind — no tolerance window", () => {
    // A near-miss is still a missing migration; the schema either has the column or it does not.
    const v = compareMigrationState({
      liveWhen: JOURNAL_0099 - 1,
      journalWhen: JOURNAL_0099,
      journalTag: "0099_slim_crystal",
    });

    expect(v.ok).toBe(false);
  });
});
