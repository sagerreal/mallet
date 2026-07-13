import { describe, it, expect } from "vitest";
import {
  buildContextBlocks,
  buildJobInfoBlock,
  buildLaborRatesBlock,
  buildPricebookBlock,
  buildWonQuotesBlock,
  clip,
  matchWonQuotes,
  stagesFor,
  EMPTY_ESTIMATE_CONTEXT,
  WON_QUOTES_BLOCK_MAX,
  type EstimateContext,
  type WonQuoteExemplar,
} from "./estimate-context";

const WON: WonQuoteExemplar[] = [
  {
    num: "EST-1042",
    title: "Water heater replacement",
    lines: [
      { description: "40-gal gas water heater (Rheem)", quantity: 1, rateCents: 165000 },
      { description: "Haul away old unit", quantity: 1, rateCents: 15000 },
    ],
    totalCents: 180000,
  },
  {
    num: "EST-1050",
    title: "Kitchen drain clear",
    lines: [{ description: "Hydro-jet kitchen drain line", quantity: 1, rateCents: 45000 }],
    totalCents: 45000,
  },
  {
    num: "EST-1055",
    title: null,
    lines: [{ description: "Toilet install — Toto Drake", quantity: 1, rateCents: 46000 }],
    totalCents: 46000,
  },
];

describe("matchWonQuotes", () => {
  it("ranks by lexical overlap with the description", () => {
    const hits = matchWonQuotes("replace 40-gal water heater and haul away", WON);
    expect(hits[0]!.num).toBe("EST-1042");
  });

  it("returns nothing on zero overlap — no misleading exemplars", () => {
    expect(matchWonQuotes("panel upgrade 200 amp", WON)).toHaveLength(0);
  });

  it("caps at the limit and keeps newest-first order on ties", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...WON[0]!,
      num: `EST-${i}`,
    }));
    const hits = matchWonQuotes("water heater", many, 3);
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.num)).toEqual(["EST-0", "EST-1", "EST-2"]);
  });

  it("ignores stop words so generic verbs don't match everything", () => {
    // "replace" and "install" are stop words; only real tokens count.
    expect(matchWonQuotes("replace install new", WON)).toHaveLength(0);
  });
});

describe("prompt blocks", () => {
  it("pricebook block renders price, category, and labor hours when present", () => {
    const block = buildPricebookBlock([
      { name: "WH install", unitPriceCents: 165000, category: "Water heaters", laborHours: 3 },
      { name: "Trip fee", unitPriceCents: 8900, category: null, laborHours: null },
    ]);
    expect(block).toContain("- WH install [Water heaters]: $1650.00 — 3h labor");
    expect(block).toContain("- Trip fee: $89.00");
    expect(block).toContain("Off-book:");
  });

  it("labor rates block renders hourly and flat kinds", () => {
    const block = buildLaborRatesBlock([
      { label: "Standard", rateCentsPerHour: 14500, kind: "hourly" },
      { label: "Service call", rateCentsPerHour: 9900, kind: "flat_fee" },
    ]);
    expect(block).toContain("- Standard: $145.00/hour");
    expect(block).toContain("- Service call: $99.00 flat");
  });

  it("job info block carries lead fields, texts, and visit notes with truncation", () => {
    const block = buildJobInfoBlock({
      lead: { name: "Dana", source: "Angi", notes: "x".repeat(600), address: "12 Elm St" },
      messages: [{ direction: "inbound", body: "heater leaking from the bottom" }],
      visitNotes: ["tank rusted through, recommend replace"],
    });
    expect(block).toContain("Customer: Dana (came in via Angi)");
    expect(block).toContain("Service address: 12 Elm St");
    expect(block).toContain("Customer: heater leaking from the bottom");
    expect(block).toContain("- tank rusted through, recommend replace");
    expect(block).toContain("…"); // the 600-char note clipped
  });

  it("won quotes block includes num/title/lines/total and respects the byte cap", () => {
    const block = buildWonQuotesBlock(WON);
    expect(block).toContain("EST-1042 — Water heater replacement (total $1800.00)");
    expect(block).toContain("@ $1650.00");
    expect(block.length).toBeLessThanOrEqual(WON_QUOTES_BLOCK_MAX);
  });

  it("empty context builds an empty string — no headers over nothing", () => {
    expect(buildContextBlocks(EMPTY_ESTIMATE_CONTEXT)).toBe("");
  });
});

describe("stagesFor", () => {
  it("reports real counts and null jobInfo without a lead", () => {
    const ctx: EstimateContext = {
      catalog: [{ name: "a", unitPriceCents: 1, category: null, laborHours: null }],
      laborRates: [{ label: "Std", rateCentsPerHour: 1, kind: "hourly" }],
      jobInfo: null,
      wonQuotes: [WON[0]!],
    };
    expect(stagesFor(ctx)).toEqual({
      jobInfo: null,
      pricebook: { services: 1, laborRates: 1 },
      wonQuotes: { count: 1, nums: ["EST-1042"] },
    });
  });

  it("counts lead notes as one artifact only when non-blank", () => {
    const ctx: EstimateContext = {
      ...EMPTY_ESTIMATE_CONTEXT,
      jobInfo: {
        lead: { name: "D", source: null, notes: "  ", address: null },
        messages: [{ direction: "inbound", body: "hi" }],
        visitNotes: [],
      },
    };
    expect(stagesFor(ctx).jobInfo).toEqual({ notes: 0, texts: 1, visitNotes: 0 });
  });
});

describe("clip", () => {
  it("passes short strings through and clips long ones with an ellipsis", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("abcdefghijk", 10)).toBe("abcdefghi…");
    expect(clip("abcdefghijk", 10)).toHaveLength(10);
  });
});
