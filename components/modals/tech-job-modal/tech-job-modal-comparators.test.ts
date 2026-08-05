/**
 * Comparator-correctness matrix for the tech-job-modal's memoized sections.
 *
 * These comparators are THE stale-UI risk of the A2 render optimization: a comparator
 * that returns true (skip) when a field its component READS has changed silently freezes
 * that section. Each test drives the exact contract:
 *   - a verify-only change (the checklist tap) → true = SKIP (the whole point of A2)
 *   - a change to any field the section's body reads → false = RE-RENDER
 * Field lists were audited against the component bodies (incl. helpers: jobTotal→lines,
 * jobNoteEntries→notes+acts). If a section grows a new job.<field> read, add it to the
 * comparator AND to this matrix.
 */
import { describe, it, expect } from "vitest";
import { techHeaderPropsEqual } from "./tech-header";
import { workOrderPropsEqual } from "./work-order-sec";
import { foundWorkPropsEqual } from "./found-work-sec";
import { noteFeedPropsEqual } from "./note-feed";
import { doneBlockPropsEqual } from "./done-block";
import type { Job } from "@/lib/store/types";

// A minimal store-shaped job; the comparators only touch the listed fields.
const baseJob = {
  id: "j1",
  title: "Water heater swap",
  lines: [{ d: "Swap heater", r: 900 }],
  photos: [],
  addons: [],
  notes: "note",
  acts: [],
  special: "gate code 4411",
  prep: "shut off water",
  invRequested: false,
  verify: { items: [], done: {} },
} as unknown as Job;

/** A checklist tap: a NEW job object whose verify changed but nothing else did. */
const verifyTapped = (j: Job): Job =>
  ({ ...(j as object), verify: { items: [], done: { a: true } } }) as unknown as Job;

/** A new job object with one field replaced by a NEW reference/value. */
const withField = (j: Job, field: string, value: unknown): Job =>
  ({ ...(j as object), [field]: value }) as unknown as Job;

const noop = () => null;

describe("techHeaderPropsEqual", () => {
  const visit = { id: "v1", date: "2026-08-04", techId: "t1", start: 15, dur: 2, status: "scheduled" };
  const props = { job: baseJob, custName: "Marta Delgado", visit };
  it("SKIPS on a verify-only change", () => {
    expect(techHeaderPropsEqual(props, { ...props, job: verifyTapped(baseJob) })).toBe(true);
  });
  // tradeLabel reads svc → title → jobMode(kind, lines); visitWhenLabel reads date + start.
  it.each(["svc", "title", "kind", "lines"])("re-renders when job.%s changes (tradeLabel reads it)", (f) => {
    expect(techHeaderPropsEqual(props, { ...props, job: withField(baseJob, f, f === "lines" ? [] : "X") })).toBe(false);
  });
  it("re-renders when the customer's name changes", () => {
    expect(techHeaderPropsEqual(props, { ...props, custName: "Someone Else" })).toBe(false);
  });
  it.each(["date", "start"])("re-renders when the visit's %s moves", (f) => {
    expect(techHeaderPropsEqual(props, { ...props, visit: { ...visit, [f]: f === "date" ? "2026-08-05" : 9 } })).toBe(false);
  });
  it("re-renders when the visit appears or disappears", () => {
    expect(techHeaderPropsEqual(props, { ...props, visit: undefined })).toBe(false);
  });
});

describe("workOrderPropsEqual", () => {
  const props = { job: baseJob, seesPrice: true };
  it("SKIPS on a verify-only change (the checklist tap)", () => {
    expect(workOrderPropsEqual(props, { ...props, job: verifyTapped(baseJob) })).toBe(true);
  });
  it.each(["lines", "photos", "title", "special", "prep"])("re-renders when job.%s changes", (f) => {
    expect(workOrderPropsEqual(props, { ...props, job: withField(baseJob, f, f === "title" ? "X" : []) })).toBe(false);
  });
  it("re-renders when seesPrice flips", () => {
    expect(workOrderPropsEqual(props, { ...props, seesPrice: false })).toBe(false);
  });
});

describe("foundWorkPropsEqual", () => {
  const props = {
    job: baseJob,
    seesPrice: true,
    readOnly: false,
    addAddon: noop as never,
    setAddonStatus: noop as never,
  };
  it("SKIPS on a verify-only change", () => {
    expect(foundWorkPropsEqual(props, { ...props, job: verifyTapped(baseJob) })).toBe(true);
  });
  it("re-renders when job.addons changes", () => {
    expect(foundWorkPropsEqual(props, { ...props, job: withField(baseJob, "addons", [{}]) })).toBe(false);
  });
  it("re-renders when the handlers are replaced (unstable callback = no silent skip)", () => {
    expect(foundWorkPropsEqual(props, { ...props, addAddon: (() => null) as never })).toBe(false);
  });
});

describe("noteFeedPropsEqual", () => {
  const props = { job: baseJob, canCompose: true, updateJob: noop as never };
  it("SKIPS on a verify-only change", () => {
    expect(noteFeedPropsEqual(props, { ...props, job: verifyTapped(baseJob) })).toBe(true);
  });
  it.each(["notes", "acts"])("re-renders when job.%s changes (jobNoteEntries reads both)", (f) => {
    expect(noteFeedPropsEqual(props, { ...props, job: withField(baseJob, f, f === "notes" ? "new" : [{}]) })).toBe(false);
  });
});

describe("doneBlockPropsEqual", () => {
  const props = {
    job: baseJob,
    lead: undefined,
    invoice: undefined,
    onOpenCloseOut: noop,
    onOpenInvoice: noop as never,
    onChargeOnFile: noop,
    onSendToOffice: noop,
  };
  it("SKIPS on a verify-only change", () => {
    expect(doneBlockPropsEqual(props as never, { ...props, job: verifyTapped(baseJob) } as never)).toBe(true);
  });
  it("re-renders when job.lines changes (jobTotal reads lines)", () => {
    expect(doneBlockPropsEqual(props as never, { ...props, job: withField(baseJob, "lines", []) } as never)).toBe(false);
  });
  it("re-renders when job.invRequested flips", () => {
    expect(doneBlockPropsEqual(props as never, { ...props, job: withField(baseJob, "invRequested", true) } as never)).toBe(false);
  });
});
