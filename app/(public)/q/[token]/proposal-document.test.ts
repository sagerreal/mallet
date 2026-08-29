/**
 * What the customer's copy renders, and how.
 *
 * Two rules matter here and both are about not showing the wrong thing to a customer: a page
 * with pictures is not blank, and an accent that is not a colour never reaches a style
 * attribute on a page anyone with the link can open.
 */
import { describe, it, expect } from "vitest";
import { docPages, docHasCoverSheet, snapshotSheetStyle, type ProposalSnapshot } from "./ProposalDocument";

const page = (key: string, body = "", photos?: ProposalSnapshot["pages"][number]["photos"]) => ({
  key,
  title: key,
  body,
  ...(photos ? { photos } : {}),
});

const snapshot = (over: Partial<ProposalSnapshot> = {}): ProposalSnapshot => ({
  templateName: "Interior",
  pages: [page("cover", "12 Alder Ct")],
  ...over,
});

describe("docHasCoverSheet", () => {
  it("gives Full its own cover sheet and keeps Simple to one page", () => {
    expect(docHasCoverSheet(snapshot({ mode: "full" }))).toBe(true);
    expect(docHasCoverSheet(snapshot({ mode: "simple" }))).toBe(false);
  });

  it("treats a snapshot with no mode as Simple — the historical shape", () => {
    expect(docHasCoverSheet(snapshot())).toBe(false);
  });
});

describe("docPages", () => {
  const written = [
    page("cover", "12 Alder Ct"),
    page("letter", "Hi Dana —"),
    page("about", "Family-run since 2009."),
    page("photos", "", [{ id: "p1", key: "a.jpg" }]),
    page("reviews", ""),
  ];

  it("orders the Full document the way it reads", () => {
    expect(docPages(snapshot({ mode: "full", pages: written })).map((p) => p.key)).toEqual([
      "letter",
      "about",
      "photos",
    ]);
  });

  it("renders a page with PICTURES and no prose", () => {
    // The photos page's whole content is its photos; testing the body alone dropped it.
    expect(docPages(snapshot({ mode: "full", pages: written })).map((p) => p.key)).toContain("photos");
  });

  it("drops a page with neither words nor pictures", () => {
    expect(docPages(snapshot({ mode: "full", pages: written })).map((p) => p.key)).not.toContain("reviews");
  });

  it("keeps only the photos in Simple — a one-page quote still wants the before-and-afters", () => {
    expect(docPages(snapshot({ mode: "simple", pages: written })).map((p) => p.key)).toEqual(["photos"]);
  });

  it("never renders the cover through this list — the sheet places it itself", () => {
    expect(docPages(snapshot({ mode: "full", pages: written })).map((p) => p.key)).not.toContain("cover");
  });
});

describe("snapshotSheetStyle", () => {
  const style = (design: ProposalSnapshot["design"]) =>
    snapshotSheetStyle(snapshot({ design })) as Record<string, unknown>;

  it("carries the shop's size, font and accent onto the sheet", () => {
    const s = style({ font: "serif", size: 18, accent: "#2E5E4E" });
    expect(s["--doc-size"]).toBe("18px");
    expect(s["--doc-accent"]).toBe("#2E5E4E");
    expect(String(s["--doc-font"])).toContain("Georgia");
  });

  it("refuses an accent that is not a colour, rather than writing it into a public page", () => {
    // Defence in depth: the domain validates this on every read-back, and this is the render
    // that would carry a bad one onto a page anyone with the link can open.
    expect(style({ accent: "red;content:url(x)" })["--doc-accent"]).toBeUndefined();
    expect(style({ accent: "javascript:alert(1)" })["--doc-accent"]).toBeUndefined();
  });

  it("falls back to the plain look for a snapshot with no design", () => {
    const s = style(undefined);
    expect(s["--doc-size"]).toBe("14px");
    expect(s["--doc-font"]).toBeUndefined();
    expect(s["--doc-accent"]).toBeUndefined();
  });

  it("reads bold as the default and only turns it off when told", () => {
    expect(style({})["--doc-head-weight"]).toBe(800);
    expect(style({ bold: false })["--doc-head-weight"]).toBe(650);
  });
});
