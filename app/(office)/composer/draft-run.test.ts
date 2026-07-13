/**
 * app/(office)/composer/draft-run.test.ts
 * The staged reveal's honesty contract, on the pure stage builder: never
 * render a stage that didn't happen — and never render one it can't yet KNOW
 * happened. The rules stage only exists once the draft response confirms
 * rules actually matched (count > 0); rendering it speculatively while the
 * model works meant every no-rules shop watched the row tick, then pop out.
 */

import { describe, it, expect } from "vitest";
import { stageViews, type DraftRunProps } from "./draft-run";

const props = (over: Partial<DraftRunProps> = {}): DraftRunProps => ({
  hasLead: false,
  gather: null,
  pricebook: { services: 3, laborRates: 1 },
  result: null,
  onDone: () => {},
  ...over,
});

const keys = (p: DraftRunProps): string[] => stageViews(p).map((s) => s.key);

describe("stageViews — the rules stage renders only when rules actually matched", () => {
  it("omits the rules stage while the model is still working (result unknown)", () => {
    expect(keys(props({ result: null }))).toEqual(["job", "book", "won", "build"]);
  });

  it("adds the rules stage on completion when rules matched", () => {
    const p = props({ result: { wonQuotes: { count: 0, nums: [] }, rules: { count: 2 }, summary: null } });
    expect(keys(p)).toEqual(["job", "book", "rules", "won", "build"]);
    const rules = stageViews(p).find((s) => s.key === "rules")!;
    expect(rules.detail).toBe("2 rules");
    expect(rules.ready).toBe(true);
  });

  it("omits the rules stage when zero rules matched", () => {
    const p = props({ result: { wonQuotes: { count: 0, nums: [] }, rules: { count: 0 }, summary: null } });
    expect(keys(p)).toEqual(["job", "book", "won", "build"]);
  });

  it("omits the rules stage for old payloads without the field (deploy skew)", () => {
    const p = props({ result: { wonQuotes: { count: 1, nums: ["Q-1037"] }, rules: null, summary: null } });
    expect(keys(p)).toEqual(["job", "book", "won", "build"]);
  });

  it("keeps the job-info stage first when a lead is attached", () => {
    const p = props({ hasLead: true, gather: { notes: 1, texts: 2, visitNotes: 0, source: null } });
    expect(keys(p)).toEqual(["job", "book", "won", "build"]);
  });
});
