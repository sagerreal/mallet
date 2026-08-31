"use client";

/**
 * The document toolbar — how much document, what it looks like, and which sections are in.
 *
 * Grouped with dividers the way a document editor does it, not a row of pills: the office
 * already knows this shape from every word processor they have used, and Jakob's law says
 * spend that recognition rather than teach a new one.
 *
 * The section group only appears in Full mode. In Simple there is one page and nothing to
 * choose, so a list of section toggles would be a control that decides nothing.
 */

import type {
  ComposerDesign,
  ComposerPresentation,
  PresentationFont,
  PresentationMode,
  PresentationPageKey,
} from "./presentation-state";
import { designOf, modeOf } from "./presentation-state";

import { DOC_FONTS } from "@/lib/doc-fonts";

/** #rrggbb only — these are rendered into a style attribute on the customer's page. */
export const DOC_ACCENTS: { key: string; label: string; color: string }[] = [
  { key: "", label: "Black", color: "#20231E" },
  { key: "#2E5E4E", label: "Green", color: "#2E5E4E" },
  { key: "#34506B", label: "Navy", color: "#34506B" },
  { key: "#7A4632", label: "Rust", color: "#7A4632" },
  { key: "#65506F", label: "Plum", color: "#65506F" },
];

/**
 * The whole document in order. `fixed` sections are always in — listed so the outline is
 * complete, but they do not toggle: a proposal with no cover, no estimate or no terms is not
 * a proposal.
 */
export const DOC_SECTIONS: { key: PresentationPageKey | "estimate" | "terms"; label: string; fixed?: true }[] = [
  { key: "cover", label: "Cover", fixed: true },
  { key: "letter", label: "Letter" },
  { key: "about", label: "About us" },
  { key: "photos", label: "Photos" },
  { key: "process", label: "Process" },
  { key: "reviews", label: "Reviews" },
  { key: "estimate", label: "Estimate", fixed: true },
  { key: "warranty", label: "Warranty" },
  { key: "terms", label: "Terms", fixed: true },
];

const MIN_SIZE = 10;
const MAX_SIZE = 24;

export function DocToolbar({
  presentation,
  onMode,
  onDesign,
  onTogglePage,
}: {
  presentation: ComposerPresentation;
  onMode: (mode: PresentationMode) => void;
  onDesign: (patch: Partial<ComposerDesign>) => void;
  onTogglePage: (key: PresentationPageKey) => void;
}) {
  const design = designOf(presentation);
  const mode = modeOf(presentation);
  const pageOn = (key: PresentationPageKey) =>
    presentation.pages.find((page) => page.key === key)?.on ?? false;

  return (
    <div className="doctoolbar" role="toolbar" aria-label="Document formatting">
      <span className="tb-group">
        <button
          type="button"
          className="tb-btn"
          aria-pressed={mode === "simple"}
          title="One page: the work, the price, the signature and the terms"
          onClick={() => onMode("simple")}
        >
          Simple
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-pressed={mode === "full"}
          title="A cover letter and your story, then the estimate"
          onClick={() => onMode("full")}
        >
          Full proposal
        </button>
      </span>
      <span className="tb-div" aria-hidden="true" />
      <span className="tb-group">
        <select
          className="tb-select"
          aria-label="Font"
          value={design.font}
          onChange={(e) => onDesign({ font: e.target.value as PresentationFont })}
        >
          {(["Sans serif", "Serif", "Mono"] as const).map((group) => (
            <optgroup key={group} label={group}>
              {DOC_FONTS.filter((font) => font.group === group).map((font) => (
                <option key={font.key} value={font.key}>
                  {font.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </span>
      <span className="tb-div" aria-hidden="true" />
      <SizeGroup size={design.size} onSize={(size) => onDesign({ size })} />
      <span className="tb-div" aria-hidden="true" />
      <EmphasisGroup design={design} onDesign={onDesign} />
      {mode === "full" && (
        <>
          <span className="tb-div" aria-hidden="true" />
          <SectionGroup pageOn={pageOn} onTogglePage={onTogglePage} />
        </>
      )}
    </div>
  );
}

/** The document's type size, bounded by what a page can actually hold. */
function SizeGroup({ size, onSize }: { size: number; onSize: (size: number) => void }) {
  const clamp = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
  return (
    <span className="tb-group tb-size">
      <button type="button" aria-label="Decrease font size" onClick={() => onSize(clamp(size - 1))}>
        −
      </button>
      <input
        aria-label="Font size"
        inputMode="numeric"
        value={size}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onSize(clamp(next));
        }}
      />
      <button type="button" aria-label="Increase font size" onClick={() => onSize(clamp(size + 1))}>
        +
      </button>
    </span>
  );
}

/** Bold, italic, and the accent — the look of the headings, not the words. */
function EmphasisGroup({
  design,
  onDesign,
}: {
  design: ComposerDesign;
  onDesign: (patch: Partial<ComposerDesign>) => void;
}) {
  return (
    <span className="tb-group">
      <button
        type="button"
        className="tb-btn"
        style={{ fontWeight: 800 }}
        aria-pressed={design.bold}
        aria-label="Bold headings"
        title="Bold headings"
        onClick={() => onDesign({ bold: !design.bold })}
      >
        B
      </button>
      <button
        type="button"
        className="tb-btn"
        style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}
        aria-pressed={design.italic}
        aria-label="Italic subtitle"
        title="Italic subtitle"
        onClick={() => onDesign({ italic: !design.italic })}
      >
        I
      </button>
      <span className="tb-swatches">
        {DOC_ACCENTS.map((accent) => (
          <button
            key={accent.key || "default"}
            type="button"
            className="tb-swatch"
            style={{ background: accent.color }}
            aria-label={`${accent.label} accent`}
            aria-pressed={design.accent === accent.key}
            onClick={() => onDesign({ accent: accent.key })}
          />
        ))}
        {/* The whole gamut, not just the five quick picks. A native colour input — the value
            is always #rrggbb, which is exactly what the transport's regex admits. */}
        <input
          type="color"
          className="tb-swatch tb-swatch-any"
          aria-label="Custom accent colour"
          title="Any colour"
          value={design.accent || "#20231E"}
          onChange={(e) => onDesign({ accent: e.target.value })}
        />
      </span>
    </span>
  );
}

/** Which sections are in. Full only — in Simple there is one page and nothing to choose. */
function SectionGroup({
  pageOn,
  onTogglePage,
}: {
  pageOn: (key: PresentationPageKey) => boolean;
  onTogglePage: (key: PresentationPageKey) => void;
}) {
  return (
    <span className="tb-group">
      {DOC_SECTIONS.map((section) =>
        section.fixed ? (
          <button
            key={section.key}
            type="button"
            className="tb-page"
            disabled
            aria-pressed
            title="Always in the proposal"
          >
            {section.label}
          </button>
        ) : (
          <button
            key={section.key}
            type="button"
            className="tb-page"
            aria-pressed={pageOn(section.key as PresentationPageKey)}
            onClick={() => onTogglePage(section.key as PresentationPageKey)}
          >
            {section.label}
          </button>
        ),
      )}
    </span>
  );
}
