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

import { docFontStack } from "@/lib/doc-fonts";

/**
 * The design as custom properties the sheet's own type scale reads (`--type-doc-*` derive
 * from `--doc-size`). Absent properties fall back in CSS rather than being written as
 * defaults here, so a document with no design set renders exactly as it always did.
 */
export function sheetStyle(design: ComposerDesign): CSSProperties {
  const stack = docFontStack(design.font);
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
  // Warranty is NOT here — it rides the estimate sheet, beside the terms, in both modes:
  // what is promised belongs on the page being signed.
  const order: PresentationPageKey[] = [
    "letter",
    "about",
    "photos",
    "process",
    "reviews",
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
 * The photos on the estimate sheet — Simple mode only: a shop sending a one-page quote still
 * wants the before-and-afters on it, but not the cover letter and the company story, which is
 * what makes a document Full. In Full the photos ride the cover sheet.
 */
export function estimateSheetPhotos(p: ComposerPresentation): ComposerPresentationPage | null {
  if (modeOf(p) === "full") return null;
  const photos = p.pages.find((page) => page.key === "photos");
  return photos?.on ? photos : null;
}

/** The warranty — rendered after the estimate, beside the terms, in BOTH modes: what is
 *  promised belongs on the page being signed. */
export function warrantySheetPage(p: ComposerPresentation): ComposerPresentationPage | null {
  const warranty = p.pages.find((page) => page.key === "warranty");
  return warranty?.on ? warranty : null;
}
