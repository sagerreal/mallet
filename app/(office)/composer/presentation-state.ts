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

export type PresentationPageKey = "cover" | "about" | "reviews" | "thanks";

export interface ComposerPresentationPage {
  key: PresentationPageKey;
  on: boolean;
  title: string;
  body: string;
}

export interface ComposerPresentation {
  /** Null when the copy is unlinked from any template (a revise of a sent quote). */
  templateId: string | null;
  name: string;
  pages: ComposerPresentationPage[];
}

/** The wire shape frozen onto the estimate — ON pages only, activation resolved away. */
export interface PresentationSnapshotPayload {
  templateName: string;
  pages: { key: PresentationPageKey; title: string; body: string }[];
}

/**
 * The draft-payload snapshot, or undefined when there is nothing to freeze (no presentation
 * picked, or every page toggled off — an all-off presentation IS a plain quote).
 */
export function presentationSnapshotForPayload(
  p: ComposerPresentation | null,
): PresentationSnapshotPayload | undefined {
  if (!p) return undefined;
  const pages = p.pages
    .filter((page) => page.on)
    .map((page) => ({ key: page.key, title: page.title, body: page.body }));
  if (pages.length === 0) return undefined;
  return { templateName: p.name, pages };
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
  };
}

/** Toggle one page of the per-quote copy. The cover never toggles off — a presentation without
 *  its first page is just a plain quote, which "No presentation" already expresses. */
export function togglePresentationPage(
  p: ComposerPresentation,
  key: PresentationPageKey,
): ComposerPresentation {
  if (key === "cover") return p;
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
