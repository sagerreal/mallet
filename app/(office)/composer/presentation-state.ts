/**
 * Presentation — the designed pages (cover, about us, reviews, thank-you) that wrap a quote
 * into a proposal. The composer holds a PER-QUOTE COPY of a template's pages: picking a
 * template seeds it, page on/off toggles edit the copy, and the draft payload freezes the ON
 * pages into the estimate's presentationSnapshot (same semantics as termsSnapshot). Template
 * CONTENT edits write through to the org template via settings — content is shared, activation
 * is per-quote (the PaintScout model).
 *
 * Split from composer-state.ts to keep that file under the 800-line cap; composer-state
 * re-exports everything here, so import sites are unchanged.
 */

/**
 * The pages a proposal may carry, in the order they read. Mirrors the domain's
 * PRESENTATION_PAGE_KEYS — `terms` and the estimate are not here: the terms come from the
 * quote's own snapshot and the estimate from its lines, so neither is a page anyone writes.
 */
export type PresentationPageKey =
  | "cover"
  | "letter"
  | "about"
  | "photos"
  | "process"
  | "reviews"
  | "warranty"
  | "thanks";

/**
 * How much document goes out. Simple is one page — the work, the price, the signature and the
 * terms. Full puts a cover letter and the shop's story in front of it. Simple is the default
 * because most quotes are not a pitch.
 */
export type PresentationMode = "simple" | "full";

import type { DocFontKey } from "@/lib/doc-fonts";

/** A key from lib/doc-fonts DOC_FONTS. Unknown keys render the default face — never a crash. */
export type PresentationFont = DocFontKey;

/** One photo, or a before/after PAIR — the thing trades actually send. */
export interface ComposerPhoto {
  id: string;
  /** The object key in the private bucket. Never a URL — see PresentationPhoto. */
  key: string;
  /** The BEFORE image when this entry is a pair. Absent means a single photo. */
  beforeKey?: string;
  caption?: string;
}

/** The shop's look, applied to the whole document. */
export interface ComposerDesign {
  font: PresentationFont;
  size: number;
  /** "" means the default ink. */
  accent: string;
  bold: boolean;
  italic: boolean;
}

/** What the cover prints beside the title — all of it editable on the page itself. */
export interface ComposerDocMeta {
  estimator: string;
  estimatorRole: string;
  contact: string;
  estNumber: string;
  validity: string;
  date: string;
}

/** The look a document starts with: deliberately plain until the shop changes it. */
export const DEFAULT_DESIGN: ComposerDesign = {
  font: "basic",
  size: 14,
  accent: "",
  bold: true,
  italic: false,
};

export interface ComposerPresentationPage {
  key: PresentationPageKey;
  on: boolean;
  title: string;
  body: string;
  /** Only the photos page carries these. */
  photos?: ComposerPhoto[];
}

export interface ComposerPresentation {
  /** Null when the copy is unlinked from any template (a revise of a sent quote). */
  templateId: string | null;
  name: string;
  pages: ComposerPresentationPage[];
  /** Absent reads as 'simple' — the historical shape, and still the default. */
  mode?: PresentationMode;
  design?: Partial<ComposerDesign>;
  meta?: Partial<ComposerDocMeta>;
}

/** The wire shape frozen onto the estimate — ON pages only, activation resolved away. */
export interface PresentationSnapshotPayload {
  templateName: string;
  pages: { key: PresentationPageKey; title: string; body: string; photos?: ComposerPhoto[] }[];
  mode?: PresentationMode;
  /** Partial because an older snapshot may carry only some of the look. designOf fills the rest. */
  design?: Partial<ComposerDesign>;
  meta?: Partial<ComposerDocMeta>;
}

/**
 * The draft-payload snapshot, or undefined when there is nothing to freeze (no presentation
 * picked, or every page toggled off — an all-off presentation IS a plain quote).
 */
export function presentationSnapshotForPayload(
  p: ComposerPresentation | null,
): PresentationSnapshotPayload | undefined {
  if (!p) return undefined;
  // What is ON travels, whatever the mode. Mode is a RENDERING choice — it decides how much of
  // the document the customer is shown, not which pages exist. Filtering here instead would
  // delete a shop's story from a quote the moment they previewed it as Simple, and would have
  // silently stripped pages from every quote already in flight, since an older snapshot carries
  // no mode at all.
  const pages = p.pages
    .filter((page) => page.on)
    .map((page) => ({
      key: page.key,
      title: page.title,
      body: page.body,
      ...(page.photos && page.photos.length > 0 ? { photos: page.photos } : {}),
    }));
  if (pages.length === 0) return undefined;
  return {
    // The transport requires a non-empty name; the default document has none of its own.
    templateName: p.name.trim() || "Document",
    pages,
    ...(p.mode === undefined ? {} : { mode: p.mode }),
    ...(p.design === undefined ? {} : { design: p.design }),
    ...(p.meta === undefined ? {} : { meta: p.meta }),
  };
}

/**
 * The presentation every quote STARTS with — the mock's model, verbatim: "Every quote goes out
 * as a document. The choice is how much of one." Simple mode; the standard page set with EMPTY
 * bodies (an empty page hides from the customer, so this sends as the minimal one-page
 * document: cover head, the estimate, the acceptance, the terms). Unlinked — edits stay on
 * this quote until a template is picked.
 */
export function defaultPresentation(): ComposerPresentation {
  return {
    templateId: null,
    name: "",
    mode: "simple",
    pages: [
      { key: "cover", on: true, title: "", body: "" },
      { key: "letter", on: true, title: "A note from us", body: "" },
      { key: "about", on: true, title: "About us", body: "" },
      { key: "photos", on: true, title: "Photos", body: "", photos: [] },
      { key: "process", on: false, title: "How the job goes", body: "" },
      { key: "reviews", on: true, title: "Reviews", body: "" },
      { key: "warranty", on: true, title: "Our warranty", body: "" },
      { key: "thanks", on: true, title: "Thank you", body: "" },
    ],
  };
}

/**
 * Restore a persisted snapshot into the composer (the ?revise= path). The copy comes back
 * UNLINKED (templateId null): the snapshot froze pages as they were sent, which may no longer
 * match any live template — editing shared content from a frozen copy would silently rewrite
 * pages the shop believes are historical. Every snapshotted page was ON by definition.
 */
export function presentationFromSnapshot(
  snapshot: PresentationSnapshotPayload | null,
): ComposerPresentation | null {
  if (!snapshot || snapshot.pages.length === 0) return null;
  return {
    templateId: null,
    name: snapshot.templateName,
    pages: snapshot.pages.map((page) => ({ ...page, on: true })),
    ...(snapshot.mode === undefined ? {} : { mode: snapshot.mode }),
    ...(snapshot.design === undefined ? {} : { design: snapshot.design }),
    ...(snapshot.meta === undefined ? {} : { meta: snapshot.meta }),
  };
}

/** What a page is called before the shop renames it. */
const DEFAULT_PAGE_TITLES: Record<PresentationPageKey, string> = {
  cover: "Cover",
  letter: "A note from us",
  about: "About us",
  photos: "Photos",
  process: "How the job goes",
  reviews: "What customers say",
  warranty: "Our warranty",
  thanks: "Thank you",
};

/**
 * Toggle one page of the per-quote copy.
 *
 * A page the template does not carry is CREATED, empty and on. The toolbar lists every kind a
 * proposal can have, and a control that lists something it cannot produce is a control that
 * lies — a shop whose template predates the Letter page would otherwise click Letter and watch
 * nothing happen. The empty page then says it is empty, and editing it writes through to the
 * template like any other.
 *
 * The cover never toggles off: a presentation without its first page is a plain quote, which
 * "No presentation" already expresses.
 */
export function togglePresentationPage(
  p: ComposerPresentation,
  key: PresentationPageKey,
): ComposerPresentation {
  if (key === "cover") return p;
  if (!p.pages.some((page) => page.key === key)) {
    return { ...p, pages: [...p.pages, { key, on: true, title: DEFAULT_PAGE_TITLES[key], body: "" }] };
  }
  return {
    ...p,
    pages: p.pages.map((page) => (page.key === key ? { ...page, on: !page.on } : page)),
  };
}

/** Merge a page content edit into the copy (used after a template write-through succeeds). */
export function patchPresentationPage(
  p: ComposerPresentation,
  key: PresentationPageKey,
  patch: { title?: string; body?: string },
): ComposerPresentation {
  return {
    ...p,
    pages: p.pages.map((page) => (page.key === key ? { ...page, ...patch } : page)),
  };
}

/** The document's look, with the defaults filled in for a presentation that has none. */
export function designOf(p: ComposerPresentation | null): ComposerDesign {
  return { ...DEFAULT_DESIGN, ...(p?.design ?? {}) };
}

/** Simple unless the shop said otherwise. */
export function modeOf(p: ComposerPresentation | null): PresentationMode {
  return p?.mode ?? "simple";
}

/** Change the document's look. Returns a new presentation — never mutates. */
export function patchPresentationDesign(
  p: ComposerPresentation,
  patch: Partial<ComposerDesign>,
): ComposerPresentation {
  return { ...p, design: { ...designOf(p), ...patch } };
}

/** Switch between the one-page document and the full proposal. */
export function setPresentationMode(
  p: ComposerPresentation,
  mode: PresentationMode,
): ComposerPresentation {
  return { ...p, mode };
}

/** Edit what the cover prints beside the title. */
export function patchPresentationMeta(
  p: ComposerPresentation,
  patch: Partial<ComposerDocMeta>,
): ComposerPresentation {
  return { ...p, meta: { ...(p.meta ?? {}), ...patch } };
}

/** Replace the photos on a page. Returns a new presentation — never mutates. */
export function setPagePhotos(
  p: ComposerPresentation,
  key: PresentationPageKey,
  photos: ComposerPhoto[],
): ComposerPresentation {
  return {
    ...p,
    pages: p.pages.map((page) => (page.key === key ? { ...page, photos } : page)),
  };
}
