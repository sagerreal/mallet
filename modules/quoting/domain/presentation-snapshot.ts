/**
 * The designed proposal frozen onto a quote at draft time.
 *
 * Same snapshot semantics as termsSnapshot: a later template edit never rewrites a quote
 * already sent. It carries no money and no internal fields, so it is safe on every public
 * surface by construction — the customer's page renders it directly.
 *
 * Extracted from estimate.ts, which was long past the file cap before this grew a document
 * mode, a design, cover meta and photos.
 *
 * WIDENING ONLY. This validator runs on EVERY read-back of every estimate ever saved, so a
 * rule tightened here does not reject bad new input — it makes an old, perfectly good quote
 * unreadable. Page keys may be added, never removed; new fields are optional, never required.
 */
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/**
 * The pages a proposal may carry, in the order they read.
 *
 * `terms` and the estimate itself are NOT here: the terms come from the quote's own
 * termsSnapshot and the estimate from its lines, so neither is a page whose body someone
 * writes. Putting them in this list would invite two sources for one thing.
 */
export const PRESENTATION_PAGE_KEYS = [
  "cover",
  "letter",
  "about",
  "photos",
  "process",
  "reviews",
  "warranty",
  "thanks",
] as const;
export type PresentationPageKey = (typeof PRESENTATION_PAGE_KEYS)[number];

/**
 * How much document goes out. Simple is one page — the work, the price, the signature and the
 * terms. Full puts a cover letter and the shop's story in front of it.
 */
export const PRESENTATION_MODES = ["simple", "full"] as const;
export type PresentationMode = (typeof PRESENTATION_MODES)[number];

export const PRESENTATION_FONTS = ["basic", "serif", "mono"] as const;
export type PresentationFont = (typeof PRESENTATION_FONTS)[number];

const MAX_PRESENTATION_PAGES = PRESENTATION_PAGE_KEYS.length;
const MAX_PRESENTATION_TITLE_CHARS = 120;
const MAX_PRESENTATION_BODY_CHARS = 8000;
const MAX_PHOTOS_PER_PAGE = 12;
const MAX_META_CHARS = 200;
const MIN_DOC_SIZE = 10;
const MAX_DOC_SIZE = 24;
/** #rrggbb only — the accent is rendered into a style attribute on the customer's page. */
const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * One photo on a proposal page, or a before/after PAIR — the thing trades actually send.
 *
 * Stored as object keys in the private bucket, never as URLs: a URL would either be public
 * (anyone with the link reads the shop's job photos forever) or expire inside a snapshot that
 * is supposed to be permanent. The reader mints a short-lived signed URL per view instead.
 */
export interface PresentationPhoto {
  readonly id: string;
  readonly key: string;
  /** The BEFORE image when this entry is a pair. Absent means a single photo. */
  readonly beforeKey?: string | null;
  readonly caption?: string | null;
}

export interface PresentationPage {
  readonly key: PresentationPageKey;
  readonly title: string;
  readonly body: string;
  /** Only the photos page carries these. Absent everywhere else. */
  readonly photos?: readonly PresentationPhoto[];
}

/** The shop's look. Absent on every snapshot written before the document had one. */
export interface PresentationDesign {
  readonly font?: PresentationFont;
  readonly size?: number;
  /** "" or absent means the default ink. */
  readonly accent?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/** What the cover prints beside the title — all of it editable on the page. */
export interface PresentationMeta {
  readonly estimator?: string;
  readonly estimatorRole?: string;
  readonly contact?: string;
  readonly estNumber?: string;
  readonly validity?: string;
  readonly date?: string;
}

export interface PresentationSnapshot {
  readonly templateName: string;
  readonly pages: readonly PresentationPage[];
  /** Absent reads as "simple" — the historical shape, and still the default. */
  readonly mode?: PresentationMode;
  readonly design?: PresentationDesign;
  readonly meta?: PresentationMeta;
}

const isPageKey = (value: unknown): value is PresentationPageKey =>
  typeof value === "string" && (PRESENTATION_PAGE_KEYS as readonly string[]).includes(value);

const badSnapshot = (message: string) => validation(message, "presentationSnapshot");

/** A trimmed string, or undefined when there was nothing there. Bounded like the column. */
function readMeta(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_META_CHARS);
}

function validatePhotos(
  raw: unknown,
): Result<readonly PresentationPhoto[] | undefined, ValidationError> {
  if (raw == null) return ok(undefined);
  if (!Array.isArray(raw)) return err(badSnapshot("photos must be a list"));
  if (raw.length > MAX_PHOTOS_PER_PAGE) {
    return err(badSnapshot(`a page carries at most ${MAX_PHOTOS_PER_PAGE} photos`));
  }
  const photos: PresentationPhoto[] = [];
  for (const entry of raw as PresentationPhoto[]) {
    if (typeof entry?.id !== "string" || typeof entry.key !== "string" || entry.key.length === 0) {
      return err(badSnapshot("a photo needs an id and a stored image"));
    }
    photos.push({
      id: entry.id,
      key: entry.key,
      ...(typeof entry.beforeKey === "string" && entry.beforeKey.length > 0
        ? { beforeKey: entry.beforeKey }
        : {}),
      ...(typeof entry.caption === "string" && entry.caption.trim().length > 0
        ? { caption: entry.caption.trim().slice(0, MAX_META_CHARS) }
        : {}),
    });
  }
  return ok(photos);
}

function validateDesign(raw: unknown): Result<PresentationDesign | undefined, ValidationError> {
  if (raw == null) return ok(undefined);
  if (typeof raw !== "object") return err(badSnapshot("design must be an object"));
  const d = raw as PresentationDesign;
  if (d.font !== undefined && !(PRESENTATION_FONTS as readonly string[]).includes(d.font)) {
    return err(badSnapshot(`unknown document font: ${String(d.font)}`));
  }
  if (d.size !== undefined) {
    if (typeof d.size !== "number" || d.size < MIN_DOC_SIZE || d.size > MAX_DOC_SIZE) {
      return err(badSnapshot(`document size must be between ${MIN_DOC_SIZE} and ${MAX_DOC_SIZE}`));
    }
  }
  if (d.accent !== undefined && d.accent !== "" && !ACCENT_PATTERN.test(d.accent)) {
    // The accent is rendered into a style attribute on a page anyone with the link can open.
    return err(badSnapshot("the accent must be a #rrggbb colour"));
  }
  return ok({
    ...(d.font === undefined ? {} : { font: d.font }),
    ...(d.size === undefined ? {} : { size: d.size }),
    ...(d.accent === undefined ? {} : { accent: d.accent }),
    ...(d.bold === undefined ? {} : { bold: Boolean(d.bold) }),
    ...(d.italic === undefined ? {} : { italic: Boolean(d.italic) }),
  });
}

function validateMeta(raw: unknown): PresentationMeta | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  const meta: PresentationMeta = {
    ...(readMeta(m.estimator) === undefined ? {} : { estimator: readMeta(m.estimator) }),
    ...(readMeta(m.estimatorRole) === undefined ? {} : { estimatorRole: readMeta(m.estimatorRole) }),
    ...(readMeta(m.contact) === undefined ? {} : { contact: readMeta(m.contact) }),
    ...(readMeta(m.estNumber) === undefined ? {} : { estNumber: readMeta(m.estNumber) }),
    ...(readMeta(m.validity) === undefined ? {} : { validity: readMeta(m.validity) }),
    ...(readMeta(m.date) === undefined ? {} : { date: readMeta(m.date) }),
  };
  return Object.keys(meta).length === 0 ? undefined : meta;
}

/**
 * Jsonb round-trip validation — a malformed row fails loud, the same rule tierNames follows.
 * Returns the NORMALIZED snapshot, so what the estimate holds is never the raw column.
 */
export function validatePresentationSnapshot(
  input: PresentationSnapshot | null | undefined,
): Result<PresentationSnapshot | null, ValidationError> {
  if (input == null) return ok(null);
  if (typeof input.templateName !== "string" || input.templateName.trim().length === 0) {
    return err(badSnapshot("presentation template name is required"));
  }
  if (
    !Array.isArray(input.pages) ||
    input.pages.length === 0 ||
    input.pages.length > MAX_PRESENTATION_PAGES
  ) {
    return err(badSnapshot(`a presentation carries 1-${MAX_PRESENTATION_PAGES} pages`));
  }
  if (input.mode !== undefined && !(PRESENTATION_MODES as readonly string[]).includes(input.mode)) {
    return err(badSnapshot(`unknown document mode: ${String(input.mode)}`));
  }
  const design = validateDesign(input.design);
  if (!design.ok) return design;

  const pages: PresentationPage[] = [];
  for (const page of input.pages) {
    if (!isPageKey(page.key)) {
      return err(badSnapshot(`unknown presentation page: ${String(page.key)}`));
    }
    if (typeof page.title !== "string" || page.title.length > MAX_PRESENTATION_TITLE_CHARS) {
      return err(badSnapshot(`presentation page title is limited to ${MAX_PRESENTATION_TITLE_CHARS} characters`));
    }
    if (typeof page.body !== "string" || page.body.length > MAX_PRESENTATION_BODY_CHARS) {
      return err(badSnapshot(`presentation page body is limited to ${MAX_PRESENTATION_BODY_CHARS} characters`));
    }
    const photos = validatePhotos(page.photos);
    if (!photos.ok) return photos;
    pages.push({
      key: page.key,
      title: page.title,
      body: page.body,
      ...(photos.value === undefined || photos.value.length === 0 ? {} : { photos: photos.value }),
    });
  }

  const meta = validateMeta(input.meta);
  return ok({
    templateName: input.templateName.trim(),
    pages,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(design.value === undefined || Object.keys(design.value).length === 0
      ? {}
      : { design: design.value }),
    ...(meta === undefined ? {} : { meta }),
  });
}

/**
 * Every object key a snapshot references, so a reader can mint signed URLs for exactly the
 * images this quote needs and no others.
 */
export function photoKeysIn(snapshot: PresentationSnapshot | null): string[] {
  if (!snapshot) return [];
  const keys: string[] = [];
  for (const page of snapshot.pages) {
    for (const photo of page.photos ?? []) {
      keys.push(photo.key);
      if (photo.beforeKey) keys.push(photo.beforeKey);
    }
  }
  return keys;
}
