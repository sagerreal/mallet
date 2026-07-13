/**
 * app/(office)/composer/composer-state.test.ts
 * Unit tests for the composer's pure helpers: format switching (line
 * carry-over both directions), recommended-tier line derivation at send time,
 * send gating reasons, AI-draft routing, and the quote message body.
 */

import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  aiDraftForPayload,
  applyAiDraftLines,
  applyAiDraftTiers,
  applyComposerPatch,
  buildQuoteMessageBody,
  deliveryGateReason,
  gbbTierTotal,
  hasRealLine,
  linesForSend,
  pricingSummary,
  realLines,
  realTierCount,
  recommendedTier,
  sendGateReason,
  switchToGbb,
  switchToSingle,
  tierDisplayName,
  toEstimateLines,
  updateTier,
  laborRulePayload,
  toProposalChips,
  type AiProposal,
  type AiTiersDraft,
  type ComposerLine,
  type ComposerState,
  type GBBDraft,
  type GBBTier,
  type TierKey,
} from "./composer-state";
import { JOB_TAG_MAX_LENGTH } from "@/modules/quoting/domain/quoting-rule";

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function line(d: string, q = 1, r = 0): ComposerLine {
  return { d, q, r };
}

function makeTier(k: TierKey, overrides: Partial<GBBTier> = {}): GBBTier {
  const names: Record<TierKey, string> = {
    good: "Good",
    better: "Better",
    best: "Best",
  };
  return { k, name: names[k], title: "", note: "", lines: [], ...overrides };
}

function makeGbb(overrides: Partial<GBBDraft> = {}): GBBDraft {
  return {
    rec: "good",
    opts: [
      makeTier("good", { lines: [line("Snake the drain", 1, 250)] }),
      makeTier("better", { lines: [line("Hydro-jet the line", 1, 450)] }),
      makeTier("best", { lines: [line("Install exterior cleanout", 1, 780)] }),
    ],
    ...overrides,
  };
}

function makeState(overrides: Partial<ComposerState> = {}): ComposerState {
  return { ...INITIAL_STATE, ...overrides };
}

// ---------------------------------------------------------------------------
// Format switching — single → GBB
// ---------------------------------------------------------------------------

describe("switchToGbb", () => {
  it("seeds Good with the current lines on the first switch", () => {
    const lines = [line("Replace water heater", 1, 1650), line("Permit", 1, 110)];
    const patch = switchToGbb(makeState({ lines }));

    expect(patch.format).toBe("gbb");
    const gbb = patch.gbb!;
    expect(gbb.rec).toBe("good");
    expect(gbb.opts.map((o) => o.k)).toEqual(["good", "better", "best"]);
    expect(gbb.opts[0]!.lines).toEqual(lines);
    expect(patch.switchNote).toBe(
      "Your lines moved into Good — Better & Best start empty."
    );
  });

  it("starts Better and Best with one empty row each", () => {
    const patch = switchToGbb(makeState({ lines: [line("Job", 1, 100)] }));
    const better = patch.gbb!.opts[1]!;
    const best = patch.gbb!.opts[2]!;
    expect(better.lines).toEqual([{ d: "", q: 1, r: 0 }]);
    expect(best.lines).toEqual([{ d: "", q: 1, r: 0 }]);
  });

  it("clones the lines — editing a tier later never mutates the single-format lines", () => {
    const original = [line("Replace water heater", 1, 1650)];
    const patch = switchToGbb(makeState({ lines: original }));

    patch.gbb!.opts[0]!.lines[0]!.d = "MUTATED";
    expect(original[0]!.d).toBe("Replace water heater");
  });

  it("returns lines to the RECOMMENDED tier when a GBB draft already exists", () => {
    const gbb = makeGbb({ rec: "better" });
    const state = makeState({
      format: "single",
      lines: [line("Edited in single", 1, 500)],
      gbb,
    });

    const patch = switchToGbb(state);
    const better = patch.gbb!.opts.find((o) => o.k === "better")!;
    expect(better.lines).toEqual([line("Edited in single", 1, 500)]);
    expect(patch.switchNote).toBe(
      "Your lines moved into Better — the other tiers kept their edits."
    );
  });

  it("keeps the other tiers' edits when re-entering GBB", () => {
    const gbb = makeGbb({ rec: "better" });
    const state = makeState({
      format: "single",
      lines: [line("Edited in single", 1, 500)],
      gbb,
    });

    const patch = switchToGbb(state);
    const good = patch.gbb!.opts.find((o) => o.k === "good")!;
    const best = patch.gbb!.opts.find((o) => o.k === "best")!;
    expect(good.lines).toEqual([line("Snake the drain", 1, 250)]);
    expect(best.lines).toEqual([line("Install exterior cleanout", 1, 780)]);
  });

  it("is a no-op when already in GBB format", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb() });
    expect(switchToGbb(state)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Format switching — GBB → single
// ---------------------------------------------------------------------------

describe("switchToSingle", () => {
  it("keeps the RECOMMENDED tier's lines", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb({ rec: "best" }) });
    const patch = switchToSingle(state);

    expect(patch.format).toBe("single");
    expect(patch.lines).toEqual([line("Install exterior cleanout", 1, 780)]);
    expect(patch.switchNote).toBe("Kept the Best option's lines.");
  });

  it("names the recommended tier by its EDITED name in the switch note", () => {
    const gbb = makeGbb({ rec: "better" });
    const renamed = updateTier(gbb, "better", { name: "Most popular" });
    const patch = switchToSingle(makeState({ format: "gbb", gbb: renamed }));
    expect(patch.switchNote).toBe("Kept the Most popular option's lines.");
  });

  it("clones the tier lines — later single-format edits never mutate the tier", () => {
    const gbb = makeGbb({ rec: "good" });
    const patch = switchToSingle(makeState({ format: "gbb", gbb }));

    patch.lines![0]!.d = "MUTATED";
    expect(gbb.opts[0]!.lines[0]!.d).toBe("Snake the drain");
  });

  it("does NOT clear the GBB draft — tier edits survive the round-trip", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb() });
    const patch = switchToSingle(state);
    expect("gbb" in patch).toBe(false);
  });

  it("falls back to one empty row when the recommended tier has no lines", () => {
    const gbb = makeGbb();
    const emptied = updateTier(gbb, "good", { lines: [] });
    const patch = switchToSingle(makeState({ format: "gbb", gbb: emptied }));
    expect(patch.lines).toEqual([{ d: "", q: 1, r: 0 }]);
  });

  it("is a no-op when already in single format", () => {
    expect(switchToSingle(makeState())).toEqual({});
  });

  it("round-trips: single → GBB → single preserves the lines", () => {
    const lines = [line("Replace water heater", 1, 1650), line("Permit", 1, 110)];
    const s1 = makeState({ lines });
    const s2 = { ...s1, ...switchToGbb(s1) };
    const s3 = { ...s2, ...switchToSingle(s2) };
    expect(s3.format).toBe("single");
    expect(s3.lines).toEqual(lines);
  });
});

// ---------------------------------------------------------------------------
// Recommended tier + line derivation at send time
// ---------------------------------------------------------------------------

describe("recommendedTier", () => {
  it("is null in single format even when a GBB draft exists", () => {
    expect(recommendedTier(makeState({ format: "single", gbb: makeGbb() }))).toBeNull();
  });

  it("is null in GBB format without a draft", () => {
    expect(recommendedTier(makeState({ format: "gbb", gbb: null }))).toBeNull();
  });

  it("returns the starred tier", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb({ rec: "better" }) });
    expect(recommendedTier(state)?.k).toBe("better");
  });

  it("falls back to the first tier when the starred key is missing", () => {
    const gbb = makeGbb({ rec: "best" });
    const broken: GBBDraft = { ...gbb, opts: gbb.opts.filter((o) => o.k !== "best") };
    const state = makeState({ format: "gbb", gbb: broken });
    expect(recommendedTier(state)?.k).toBe("good");
  });
});

describe("linesForSend", () => {
  it("uses the line table in single format", () => {
    const lines = [line("Job", 1, 100)];
    expect(linesForSend(makeState({ lines }))).toEqual(lines);
  });

  it("uses the RECOMMENDED tier's lines in GBB format, not the single-format lines", () => {
    const state = makeState({
      format: "gbb",
      lines: [line("Stale single line", 1, 1)],
      gbb: makeGbb({ rec: "better" }),
    });
    expect(linesForSend(state)).toEqual([line("Hydro-jet the line", 1, 450)]);
  });

  it("derives at call time — starring a different tier changes what sends", () => {
    const gbb = makeGbb({ rec: "good" });
    const before = linesForSend(makeState({ format: "gbb", gbb }));
    const after = linesForSend(
      makeState({ format: "gbb", gbb: { ...gbb, rec: "best" } })
    );
    expect(before).toEqual([line("Snake the drain", 1, 250)]);
    expect(after).toEqual([line("Install exterior cleanout", 1, 780)]);
  });
});

// ---------------------------------------------------------------------------
// Send gating — disable reason derivation
// ---------------------------------------------------------------------------

describe("hasRealLine", () => {
  it("is false for blank and whitespace-only descriptions", () => {
    expect(hasRealLine([])).toBe(false);
    expect(hasRealLine([line("")])).toBe(false);
    expect(hasRealLine([line("   ")])).toBe(false);
  });

  it("is true when any line has a real description", () => {
    expect(hasRealLine([line(""), line("Camera inspection", 1, 285)])).toBe(true);
  });
});

describe("realLines — the save-draft / send payload filter", () => {
  it("drops blank and whitespace-only rows, keeping the real ones", () => {
    const real = line("Camera inspection", 1, 285);
    expect(realLines([real, line(""), line("   ")])).toEqual([real]);
  });

  it("saved payload from a state with one real + one blank line contains only the real line", () => {
    // The composer manufactures blank rows ("+ Add line", GBB seeding) — the
    // server rejects description:"" and would roll the whole draft back.
    const state = makeState({ lines: [line("Camera inspection", 1, 285), line("")] });
    const payloadLines = toEstimateLines(realLines(linesForSend(state)));
    expect(payloadLines).toEqual([{ d: "Camera inspection", q: 1, r: 285 }]);
  });

  it("filters the RECOMMENDED tier's blanks in GBB format too", () => {
    const gbb = updateTier(makeGbb({ rec: "better" }), "better", {
      lines: [line("Hydro-jet the line", 1, 450), line("")],
    });
    const state = makeState({ format: "gbb", gbb });
    expect(realLines(linesForSend(state))).toEqual([line("Hydro-jet the line", 1, 450)]);
  });

  it("keeps optional / photo / cost flags on the surviving lines", () => {
    const flagged: ComposerLine = { d: "Valve", q: 1, r: 300, c: 120, opt: true, photo: true };
    expect(realLines([flagged, line("")])).toEqual([flagged]);
  });
});

describe("sendGateReason", () => {
  const realLines = [line("Camera inspection", 1, 285)];

  it("asks for a customer first — even when lines exist", () => {
    expect(sendGateReason(false, realLines)).toBe("Pick a customer first.");
  });

  it("asks for a line when the customer is picked but the quote is empty", () => {
    expect(sendGateReason(true, [line("")])).toBe("Add at least one line.");
  });

  it("names the recommended tier in GBB format", () => {
    expect(sendGateReason(true, [line("  ")], "Best")).toBe(
      "Add at least one line to the Best option."
    );
  });

  it("is null when the quote is sendable", () => {
    expect(sendGateReason(true, realLines)).toBeNull();
    expect(sendGateReason(true, realLines, "Better")).toBeNull();
  });
});

describe("deliveryGateReason — the send-only destination gate", () => {
  it("text channel needs a mobile number — empty, whitespace, or the — placeholder", () => {
    expect(deliveryGateReason("text", { phone: "", email: "dana@email.com" })).toBe(
      "Add a mobile number."
    );
    expect(deliveryGateReason("text", { phone: "   " })).toBe("Add a mobile number.");
    expect(deliveryGateReason("text", { phone: "—" })).toBe("Add a mobile number.");
    expect(deliveryGateReason("text", {})).toBe("Add a mobile number.");
  });

  it("email channel needs an address", () => {
    expect(deliveryGateReason("email", { phone: "(925) 555-0123" })).toBe(
      "Add an email address."
    );
    expect(deliveryGateReason("email", { email: "" })).toBe("Add an email address.");
    expect(deliveryGateReason("email", { email: "   " })).toBe("Add an email address.");
  });

  it("is null when the chosen channel has a destination on file", () => {
    expect(deliveryGateReason("text", { phone: "(925) 555-0123" })).toBeNull();
    expect(deliveryGateReason("email", { email: "dana@email.com" })).toBeNull();
  });

  it("only gates the CHOSEN channel — the other contact may be missing", () => {
    expect(deliveryGateReason("text", { phone: "(925) 555-0123", email: "" })).toBeNull();
    expect(deliveryGateReason("email", { phone: "—", email: "dana@email.com" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AI-draft routing
// ---------------------------------------------------------------------------

describe("applyAiDraftLines", () => {
  const drafted = [line("40-gal gas water heater", 1, 1650), line("Permit", 1, 110)];

  it("replaces the line table in single format and flags the draft", () => {
    const state = makeState({ lines: [line("old", 1, 1)], aiOpen: true });
    const next = applyAiDraftLines(state, drafted);

    expect(next.lines).toEqual(drafted);
    expect(next.aiOpen).toBe(false);
    expect(next.aiDrafted).toBe(true);
  });

  it("drafts into the GOOD tier in GBB format, leaving the other tiers' lines alone", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb({ rec: "better" }), aiOpen: true });
    const next = applyAiDraftLines(state, drafted);

    const good = next.gbb!.opts.find((o) => o.k === "good")!;
    const better = next.gbb!.opts.find((o) => o.k === "better")!;
    expect(good.lines).toEqual(drafted);
    expect(better.lines).toEqual([line("Hydro-jet the line", 1, 450)]);
    expect(next.aiDrafted).toBe(true);
  });

  it("moves the star to Good in GBB — the fresh AI draft is what sends", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb({ rec: "better" }) });
    const next = applyAiDraftLines(state, drafted);

    expect(next.gbb!.rec).toBe("good");
    expect(linesForSend(next)).toEqual(drafted);
  });

  it("clears a stale format-switch note — the draft rewrote the lines", () => {
    const state = makeState({
      switchNote: "Your lines moved into Good — Better & Best start empty.",
    });
    expect(applyAiDraftLines(state, drafted).switchNote).toBeNull();
  });

  it("clones the drafted lines and never mutates the input state", () => {
    const state = makeState({ lines: [line("old", 1, 1)] });
    const source = [line("drafted", 1, 100)];
    const next = applyAiDraftLines(state, source);

    source[0]!.d = "MUTATED";
    expect(next.lines[0]!.d).toBe("drafted");
    expect(state.lines[0]!.d).toBe("old");
    expect(state.aiDrafted).toBe(false);
  });

  it("freezes the AI's original lines — user edits never touch the snapshot", () => {
    const state = makeState();
    const next = applyAiDraftLines(state, drafted);
    expect(next.aiOriginal).toEqual([
      { d: "40-gal gas water heater", q: 1, r: 1650 },
      { d: "Permit", q: 1, r: 110 },
    ]);

    // Editing the visible lines leaves the frozen original alone.
    next.lines[0]!.r = 999;
    expect(next.aiOriginal![0]!.r).toBe(1650);
  });
});

describe("applyAiDraftTiers", () => {
  const tiersDraft: AiTiersDraft = {
    recommended: "better",
    good: { note: "Fix it", lines: [line("Snake the drain", 1, 250)] },
    better: { note: "Fix + prevent", lines: [line("Hydro-jet the line", 1, 450)] },
    best: { note: "Replace", lines: [line("Install exterior cleanout", 1, 780)] },
  };

  it("fills all three tier panels, moves the star, and closes the AI panel in GBB format", () => {
    const gbb = makeGbb({ rec: "good" });
    const state = makeState({ format: "gbb", gbb, aiOpen: true });
    const next = applyAiDraftTiers(state, tiersDraft);

    expect(next.gbb!.rec).toBe("better");
    expect(next.gbb!.opts.map((o) => o.note)).toEqual(["Fix it", "Fix + prevent", "Replace"]);
    expect(next.gbb!.opts[1]!.lines).toEqual([line("Hydro-jet the line", 1, 450)]);
    expect(next.aiOpen).toBe(false);
    expect(next.aiDrafted).toBe(true);
    expect(next.switchNote).toBeNull();
  });

  it("keeps user-typed tier names and titles", () => {
    const gbb = updateTier(makeGbb(), "better", { name: "Most popular", title: "Repair + prevent" });
    const next = applyAiDraftTiers(makeState({ format: "gbb", gbb }), tiersDraft);
    const better = next.gbb!.opts.find((o) => o.k === "better")!;
    expect(better.name).toBe("Most popular");
    expect(better.title).toBe("Repair + prevent");
  });

  it("is a no-op when no GBB draft exists", () => {
    const state = makeState({ format: "gbb", gbb: null });
    expect(applyAiDraftTiers(state, tiersDraft)).toBe(state);
  });

  it("freezes the AI's original lines tier-tagged for the ai_draft snapshot", () => {
    const state = makeState({ format: "gbb", gbb: makeGbb() });
    const next = applyAiDraftTiers(state, tiersDraft);
    expect(next.aiOriginal).toEqual([
      { d: "Snake the drain", q: 1, r: 250, tier: "good" },
      { d: "Hydro-jet the line", q: 1, r: 450, tier: "better" },
      { d: "Install exterior cleanout", q: 1, r: 780, tier: "best" },
    ]);
  });

  // Mid-flight GBB → single switch: the response must not land invisibly.
  it("after a switch to single: leaves the line table alone, fills the panels, and says where the draft went", () => {
    const tableLines = [line("Kept single line", 1, 500)];
    const state = makeState({
      format: "single",
      lines: tableLines,
      gbb: makeGbb({ rec: "good" }),
      aiOpen: true,
    });
    const next = applyAiDraftTiers(state, tiersDraft);

    // The visible single-format table never changes...
    expect(next.format).toBe("single");
    expect(next.lines).toEqual(tableLines);
    // ...the draft lands in the (hidden but persistent) tier panels...
    expect(next.gbb!.rec).toBe("better");
    expect(next.gbb!.opts[0]!.lines).toEqual([line("Snake the drain", 1, 250)]);
    // ...and the in-flow note names what happened and the next step.
    expect(next.aiOpen).toBe(false);
    expect(next.switchNote).toBe(
      "AI drafted three options after you switched formats — switch to Good, Better & Best to see them."
    );
  });

  it("clones the drafted lines — later edits never mutate the draft input", () => {
    const draft: AiTiersDraft = {
      ...tiersDraft,
      good: { note: "Fix it", lines: [line("Snake the drain", 1, 250)] },
    };
    const next = applyAiDraftTiers(makeState({ format: "gbb", gbb: makeGbb() }), draft);
    next.gbb!.opts[0]!.lines[0]!.d = "MUTATED";
    expect(draft.good.lines[0]!.d).toBe("Snake the drain");
  });
});

describe("aiDraftForPayload — the ai_draft snapshot on the quote payload", () => {
  const original = [
    { d: "Water heater swap labor", q: 5, r: 150 },
    { d: "40-gal tank", q: 1, r: 900 },
  ];

  it("is null before any AI draft", () => {
    expect(aiDraftForPayload(makeState())).toBeNull();
  });

  it("converts the frozen original to cents for the server", () => {
    const state = makeState({ aiDrafted: true, aiOriginal: original });
    expect(aiDraftForPayload(state)).toEqual({
      lines: [
        { description: "Water heater swap labor", quantity: 5, rateCents: 15_000 },
        { description: "40-gal tank", quantity: 1, rateCents: 90_000 },
      ],
    });
  });

  it("carries tier tags for a GBB draft", () => {
    const state = makeState({
      format: "gbb",
      aiDrafted: true,
      aiOriginal: [{ d: "Snake the drain", q: 1, r: 250, tier: "good" }],
    });
    expect(aiDraftForPayload(state)).toEqual({
      lines: [{ description: "Snake the drain", quantity: 1, rateCents: 25_000, tier: "good" }],
    });
  });

  it("drops the snapshot when the format changed since the draft (diff would be noise)", () => {
    // Drafted single, sending GBB…
    expect(aiDraftForPayload(makeState({ format: "gbb", aiDrafted: true, aiOriginal: original }))).toBeNull();
    // …and drafted tiered, sending single.
    const tiered = [{ d: "Snake the drain", q: 1, r: 250, tier: "good" as const }];
    expect(aiDraftForPayload(makeState({ format: "single", aiDrafted: true, aiOriginal: tiered }))).toBeNull();
  });
});

describe("realTierCount — the send button's option count", () => {
  it("is 0 in single format and without a GBB draft", () => {
    expect(realTierCount(makeState())).toBe(0);
    expect(realTierCount(makeState({ format: "gbb", gbb: null }))).toBe(0);
  });

  it("counts only tiers with at least one real line", () => {
    expect(realTierCount(makeState({ format: "gbb", gbb: makeGbb() }))).toBe(3);

    const twoReal = updateTier(makeGbb(), "best", { lines: [line("")] });
    expect(realTierCount(makeState({ format: "gbb", gbb: twoReal }))).toBe(2);

    const oneReal = updateTier(twoReal, "better", { lines: [line("   ")] });
    expect(realTierCount(makeState({ format: "gbb", gbb: oneReal }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tier patching + totals
// ---------------------------------------------------------------------------

describe("tierDisplayName", () => {
  it("uses the custom name when present", () => {
    expect(tierDisplayName(makeTier("better", { name: "Most popular" }))).toBe(
      "Most popular"
    );
  });

  it("falls back to the tier key's display name when the custom name trims empty", () => {
    expect(tierDisplayName(makeTier("good", { name: "" }))).toBe("Good");
    expect(tierDisplayName(makeTier("better", { name: "   " }))).toBe("Better");
    expect(tierDisplayName(makeTier("best", { name: "" }))).toBe("Best");
  });

  it("keeps labels honest through switchToSingle when the name was cleared", () => {
    const gbb = updateTier(makeGbb({ rec: "better" }), "better", { name: "  " });
    const patch = switchToSingle(makeState({ format: "gbb", gbb }));
    expect(patch.switchNote).toBe("Kept the Better option's lines.");
  });
});

describe("applyComposerPatch — stale switch-note clearing", () => {
  const noted = () =>
    makeState({
      switchNote: "Your lines moved into Good — Better & Best start empty.",
    });

  it("clears the note when the lines change", () => {
    const next = applyComposerPatch(noted(), { lines: [line("Job", 1, 100)] });
    expect(next.switchNote).toBeNull();
    expect(next.lines).toEqual([line("Job", 1, 100)]);
  });

  it("clears the note when a tier changes", () => {
    const prev = { ...noted(), format: "gbb" as const, gbb: makeGbb() };
    const next = applyComposerPatch(prev, { gbb: makeGbb({ rec: "best" }) });
    expect(next.switchNote).toBeNull();
  });

  it("keeps a note the patch itself sets — format switches stay announced", () => {
    const next = applyComposerPatch(noted(), {
      lines: [line("Job", 1, 100)],
      switchNote: "Kept the Good option's lines.",
    });
    expect(next.switchNote).toBe("Kept the Good option's lines.");
  });

  it("leaves the note alone on unrelated edits (intro, pricing, channel)", () => {
    const prev = noted();
    expect(applyComposerPatch(prev, { intro: "hey" }).switchNote).toBe(prev.switchNote);
    expect(applyComposerPatch(prev, { sendChannel: "email" }).switchNote).toBe(
      prev.switchNote
    );
  });

  it("does not mutate the previous state", () => {
    const prev = noted();
    applyComposerPatch(prev, { lines: [line("Job", 1, 100)] });
    expect(prev.switchNote).toBe("Your lines moved into Good — Better & Best start empty.");
    expect(prev.lines).toEqual([{ d: "", q: 1, r: 0 }]);
  });
});

describe("updateTier", () => {
  it("patches only the target tier and returns a new draft", () => {
    const gbb = makeGbb();
    const next = updateTier(gbb, "better", { name: "Most popular" });

    expect(next).not.toBe(gbb);
    expect(next.opts.find((o) => o.k === "better")?.name).toBe("Most popular");
    expect(next.opts.find((o) => o.k === "good")?.name).toBe("Good");
    expect(gbb.opts.find((o) => o.k === "better")?.name).toBe("Better");
  });
});

describe("gbbTierTotal", () => {
  it("sums qty × rate across the tier's lines", () => {
    const tier = makeTier("good", {
      lines: [line("A", 2, 100), line("B", 1, 50)],
    });
    expect(gbbTierTotal(tier)).toBe(250);
  });

  it("defaults missing qty to 1 and missing rate to 0", () => {
    const tier = makeTier("good", {
      lines: [
        { d: "A", r: 40 } as ComposerLine,
        { d: "B", q: 3 } as ComposerLine,
      ],
    });
    expect(gbbTierTotal(tier)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// DTO mapping + pricing summary
// ---------------------------------------------------------------------------

describe("toEstimateLines", () => {
  it("keeps d/q/r and drops unset optional fields", () => {
    expect(toEstimateLines([line("Job", 2, 100)])).toEqual([{ d: "Job", q: 2, r: 100 }]);
  });

  it("carries cost / optional / photo when set — including explicit false", () => {
    const [mapped] = toEstimateLines([
      { d: "Job", q: 1, r: 100, c: 40, opt: false, photo: true },
    ]);
    expect(mapped).toEqual({ d: "Job", q: 1, r: 100, c: 40, opt: false, photo: true });
  });
});

describe("pricingSummary", () => {
  it("is empty when nothing is set", () => {
    expect(pricingSummary({ disc: 0, dep: 0, tax: 0 })).toBe("");
  });

  it("joins the set parts with a middot", () => {
    expect(pricingSummary({ disc: 10, dep: 25, tax: 9 })).toBe(
      "10% discount · 25% deposit · 9% tax"
    );
    expect(pricingSummary({ disc: 0, dep: 0, tax: 9 })).toBe("9% tax");
  });
});

// ---------------------------------------------------------------------------
// Quote message body — intro / auto-intro
// ---------------------------------------------------------------------------

describe("buildQuoteMessageBody", () => {
  it("leads with the typed intro", () => {
    expect(
      buildQuoteMessageBody({
        firstName: "Dana",
        intro: "Great meeting you today.",
        quoteNum: "Q-1042",
        quoteLink: "https://app.test/q/tok123",
      })
    ).toBe(
      "Great meeting you today. Your quote Q-1042 is ready — view and approve here: https://app.test/q/tok123"
    );
  });

  it("falls back to the auto intro when the intro is blank or whitespace", () => {
    for (const intro of ["", "   "]) {
      expect(
        buildQuoteMessageBody({
          firstName: "Dana",
          intro,
          quoteNum: "Q-1042",
          quoteLink: "https://app.test/q/tok123",
        })
      ).toBe(
        "Hi Dana — thanks for having us out. Your quote Q-1042 is ready — view and approve here: https://app.test/q/tok123"
      );
    }
  });
});

describe("toProposalChips", () => {
  const proposals: AiProposal[] = [
    { kind: "labor_hours", serviceName: "Water heater swap", hours: 5 },
    { kind: "rule", rule: "Include haul-away on swaps" },
  ];

  it("assigns each proposal a UNIQUE stable id and starts it not-saving", () => {
    let n = 0;
    const chips = toProposalChips(proposals, () => `id-${(n += 1)}`);
    expect(chips.map((c) => c.id)).toEqual(["id-1", "id-2"]);
    expect(chips.every((c) => !c.saving)).toBe(true);
    // The proposal payload rides along untouched.
    expect(chips[0]).toMatchObject(proposals[0]!);
    expect(chips[1]).toMatchObject(proposals[1]!);
  });

  it("does not mutate the input proposals", () => {
    const before = structuredClone(proposals);
    toProposalChips(proposals, () => "x");
    expect(proposals).toEqual(before);
  });
});

describe("laborRulePayload", () => {
  it("phrases the fact as a rule and tags it with the service name", () => {
    expect(laborRulePayload({ serviceName: "Water heater swap", hours: 5 })).toEqual({
      rule: "Water heater swap takes 5h of labor",
      jobTag: "Water heater swap",
    });
  });

  it("clips the jobTag to the server's cap so the save can't 400 forever", () => {
    // The drafter allows serviceName up to 200 chars; v1.quoting.rules.create
    // caps jobTag at JOB_TAG_MAX_LENGTH — an unclipped tag would be a permanent
    // BAD_REQUEST dressed as a transient connection error.
    const long = "x".repeat(200);
    const payload = laborRulePayload({ serviceName: long, hours: 3 });
    expect(payload.jobTag).toHaveLength(JOB_TAG_MAX_LENGTH);
    expect(payload.rule).toBe(`${long} takes 3h of labor`);
  });
});
