/**
 * The frozen proposal.
 *
 * This validator runs on EVERY read-back of every estimate ever saved, so the first thing
 * tested is that it still reads what is already in the database. A rule tightened here does
 * not reject bad new input — it makes an old, perfectly good quote unreadable.
 */
import { describe, it, expect } from "vitest";
import {
  validatePresentationSnapshot,
  photoKeysIn,
  PRESENTATION_PAGE_KEYS,
  type PresentationSnapshot,
} from "./presentation-snapshot";

const ok = (input: unknown): PresentationSnapshot => {
  const r = validatePresentationSnapshot(input as PresentationSnapshot);
  if (!r.ok) throw new Error(`expected a snapshot, got ${r.error.message}`);
  if (r.value === null) throw new Error("expected a snapshot, got null");
  return r.value;
};

const rejects = (input: unknown): string => {
  const r = validatePresentationSnapshot(input as PresentationSnapshot);
  if (r.ok) throw new Error("expected a validation error");
  return r.error.message;
};

/** Exactly the shape written before the document had a mode, a design, meta or photos. */
const legacy = {
  templateName: "Interior",
  pages: [
    { key: "cover", title: "Your project", body: "12 Alder Ct" },
    { key: "about", title: "About us", body: "Family-run since 2009." },
    { key: "thanks", title: "Thank you", body: "We appreciate the chance." },
  ],
};

describe("validatePresentationSnapshot — what is already stored", () => {
  it("still reads a snapshot written before any of this existed", () => {
    const snapshot = ok(legacy);
    expect(snapshot.pages.map((p) => p.key)).toEqual(["cover", "about", "thanks"]);
    expect(snapshot.mode).toBeUndefined();
    expect(snapshot.design).toBeUndefined();
    expect(snapshot.meta).toBeUndefined();
  });

  it("adds no keys of its own to an old snapshot", () => {
    // A snapshot that grows keys on read-back is one that no longer equals what was sent.
    expect(Object.keys(ok(legacy)).sort()).toEqual(["pages", "templateName"]);
    expect(Object.keys(ok(legacy).pages[0]!).sort()).toEqual(["body", "key", "title"]);
  });

  it("still accepts null — a quote with no proposal at all", () => {
    const r = validatePresentationSnapshot(null);
    expect(r.ok && r.value).toBeNull();
  });
});

describe("validatePresentationSnapshot — the pages it now allows", () => {
  it("accepts every page key the document can carry", () => {
    const snapshot = ok({
      templateName: "Fence jobs",
      pages: PRESENTATION_PAGE_KEYS.map((key) => ({ key, title: key, body: "" })),
    });
    expect(snapshot.pages).toHaveLength(PRESENTATION_PAGE_KEYS.length);
  });

  it("refuses a key it does not know", () => {
    expect(rejects({ templateName: "T", pages: [{ key: "invoice", title: "", body: "" }] })).toMatch(
      /unknown presentation page/i,
    );
  });

  it("refuses a snapshot with no pages, and one with more than there are kinds", () => {
    expect(rejects({ templateName: "T", pages: [] })).toMatch(/1-8 pages/);
    const tooMany = Array.from({ length: 9 }, () => ({ key: "about", title: "", body: "" }));
    expect(rejects({ templateName: "T", pages: tooMany })).toMatch(/1-8 pages/);
  });

  it("refuses a nameless template", () => {
    expect(rejects({ templateName: "   ", pages: legacy.pages })).toMatch(/name is required/i);
  });
});

describe("validatePresentationSnapshot — the document's look", () => {
  const withDesign = (design: unknown) => ({ ...legacy, design });

  it("keeps a font, size, accent and emphasis", () => {
    const design = ok(withDesign({ font: "serif", size: 16, accent: "#2E5E4E", bold: true, italic: false })).design;
    expect(design).toEqual({ font: "serif", size: 16, accent: "#2E5E4E", bold: true, italic: false });
  });

  it("refuses an accent that is not a colour — it is rendered into a public page's style", () => {
    // The reason this is not "tolerant on read": the value lands in a style attribute on a page
    // anyone with the link can open.
    expect(rejects(withDesign({ accent: "red; content: url(x)" }))).toMatch(/#rrggbb/);
    expect(rejects(withDesign({ accent: "javascript:alert(1)" }))).toMatch(/#rrggbb/);
  });

  it("accepts an empty accent — that is the default ink, not a missing colour", () => {
    expect(ok(withDesign({ accent: "" })).design?.accent).toBe("");
  });

  it("refuses a font it does not know and a size outside what a page can hold", () => {
    expect(rejects(withDesign({ font: "comic" }))).toMatch(/unknown document font/i);
    expect(rejects(withDesign({ size: 4 }))).toMatch(/between 10 and 24/);
    expect(rejects(withDesign({ size: 99 }))).toMatch(/between 10 and 24/);
  });

  it("refuses a mode it does not know", () => {
    expect(rejects({ ...legacy, mode: "fancy" })).toMatch(/unknown document mode/i);
  });

  it("keeps both modes", () => {
    expect(ok({ ...legacy, mode: "simple" }).mode).toBe("simple");
    expect(ok({ ...legacy, mode: "full" }).mode).toBe("full");
  });
});

describe("validatePresentationSnapshot — cover meta", () => {
  it("keeps what the cover prints, trimmed", () => {
    const meta = ok({ ...legacy, meta: { estimator: "  Dana Reyes  ", contact: "555-0142" } }).meta;
    expect(meta).toEqual({ estimator: "Dana Reyes", contact: "555-0142" });
  });

  it("drops the fields nobody filled in rather than storing empty strings", () => {
    expect(ok({ ...legacy, meta: { estimator: "   ", contact: "" } }).meta).toBeUndefined();
  });
});

describe("validatePresentationSnapshot — photos", () => {
  const photoPage = (photos: unknown) => ({
    templateName: "T",
    pages: [{ key: "photos", title: "Photos", body: "", photos }],
  });

  it("keeps a single photo and a before/after pair", () => {
    const pages = ok(
      photoPage([
        { id: "p1", key: "org/a.jpg" },
        { id: "p2", key: "org/after.jpg", beforeKey: "org/before.jpg", caption: "North run" },
      ]),
    ).pages;
    expect(pages[0]?.photos).toEqual([
      { id: "p1", key: "org/a.jpg" },
      { id: "p2", key: "org/after.jpg", beforeKey: "org/before.jpg", caption: "North run" },
    ]);
  });

  it("refuses a photo with no stored image behind it", () => {
    expect(rejects(photoPage([{ id: "p1", key: "" }]))).toMatch(/needs an id and a stored image/i);
    expect(rejects(photoPage([{ key: "org/a.jpg" }]))).toMatch(/needs an id and a stored image/i);
  });

  it("drops an empty photo list rather than storing the key", () => {
    expect(ok(photoPage([])).pages[0]?.photos).toBeUndefined();
  });

  it("bounds how many a page can carry", () => {
    const many = Array.from({ length: 13 }, (_v, i) => ({ id: `p${i}`, key: `org/${i}.jpg` }));
    expect(rejects(photoPage(many))).toMatch(/at most 12 photos/);
  });
});

describe("photoKeysIn", () => {
  it("names every image a snapshot references, both halves of a pair", () => {
    const snapshot = ok({
      templateName: "T",
      pages: [
        { key: "photos", title: "", body: "", photos: [{ id: "p1", key: "a.jpg", beforeKey: "b.jpg" }] },
        { key: "about", title: "", body: "" },
      ],
    });
    expect(photoKeysIn(snapshot)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("names nothing for a snapshot with no photos, or none at all", () => {
    expect(photoKeysIn(ok(legacy))).toEqual([]);
    expect(photoKeysIn(null)).toEqual([]);
  });
});
