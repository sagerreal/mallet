/**
 * How the proposal's look becomes CSS, and which pages a document actually renders.
 *
 * Pure, and separate from the tab, because both the office's editor and the customer's page
 * have to reach the same answer from the same snapshot — the same reason quote-totals.ts is
 * shared with `/q`. A second implementation is a second document.
 */

import type { CSSProperties } from "react";
import type {
  ComposerDesign,
  ComposerPresentation,
  ComposerPresentationPage,
  PresentationPageKey,
} from "./presentation-state";
import { designOf, modeOf } from "./presentation-state";

const FONT_STACKS: Record<ComposerDesign["font"], string> = {
  basic: "",
  serif: "'Iowan Old Style', Palatino, Charter, Georgia, serif",
  mono: "var(--font-space-mono), ui-monospace, monospace",
};

/**
 * The design as custom properties the sheet's own type scale reads (`--type-doc-*` derive
 * from `--doc-size`). Absent properties fall back in CSS rather than being written as
 * defaults here, so a document with no design set renders exactly as it always did.
 */
export function sheetStyle(design: ComposerDesign): CSSProperties {
  const stack = FONT_STACKS[design.font];
  return {
    ...(stack ? { "--doc-font": stack } : {}),
    "--doc-size": `${design.size}px`,
    ...(design.accent ? { "--doc-accent": design.accent } : {}),
    "--doc-head-weight": design.bold ? 800 : 650,
    "--doc-sub-style": design.italic ? "italic" : "normal",
  } as CSSProperties;
}

/** The design of this presentation, with the defaults filled in. */
export function sheetStyleFor(p: ComposerPresentation | null): CSSProperties {
  return sheetStyle(designOf(p));
}

/**
 * The written pages that render on the cover sheet, in document order.
 *
 * Empty in Simple mode: that document is one page — the work, the price, the signature and
 * the terms — so the shop's story is not shown, even though it is still stored. Mode decides
 * what is SHOWN; it never deletes what was written.
 */
export function coverSheetPages(p: ComposerPresentation): ComposerPresentationPage[] {
  if (modeOf(p) === "simple") return [];
  const order: PresentationPageKey[] = [
    "letter",
    "about",
    "photos",
    "process",
    "reviews",
    "warranty",
  ];
  return order
    .map((key) => p.pages.find((page) => page.key === key))
    .filter((page): page is ComposerPresentationPage => Boolean(page?.on));
}

/** Does this document lead with a cover SHEET of its own? Simple keeps the cover inline. */
export function hasCoverSheet(p: ComposerPresentation | null): boolean {
  return p !== null && modeOf(p) === "full";
}

/**
 * The written pages that render on the estimate sheet.
 *
 * In Simple that is the photos, and only the photos: a shop sending a one-page quote still
 * wants the before-and-afters on it — that is the thing trades actually send — but not the
 * cover letter and the company story, which is what makes a document Full.
 *
 * Empty in Full, where those pages live on the sheet in front.
 */
export function estimateSheetPages(p: ComposerPresentation): ComposerPresentationPage[] {
  if (modeOf(p) === "full") return [];
  const photos = p.pages.find((page) => page.key === "photos");
  return photos?.on ? [photos] : [];
}
