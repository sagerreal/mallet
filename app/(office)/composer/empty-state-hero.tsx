"use client";

/**
 * app/(office)/composer/empty-state-hero.tsx
 *
 * The empty-quote hero (B1). An empty quote used to render a dead line-table
 * grid (Description/Qty/Price headers, no rows) sitting above the command bar —
 * a blank spreadsheet as the first thing you see. This replaces that with an
 * invitation: the AI IS the empty state. The prominent prompt points down to the
 * command bar (the ONE input — we don't duplicate the field), and manual entry
 * stays one quiet click away for the owner who'd rather build by hand.
 *
 * Once any real line exists this disappears and the normal line table returns.
 */

export function EmptyStateHero({
  onAddLine,
  onOpenPricebook,
}: {
  onAddLine: () => void;
  onOpenPricebook: () => void;
}) {
  return (
    <div className="es-hero">
      <div className="es-hero-title">What&rsquo;s the job?</div>
      <div className="es-hero-eg">
        e.g. 40-gal gas water heater swap, haul away the old unit — the quote
        builds itself from your pricebook below.
      </div>
      <div className="es-hero-manual">
        <span>or build it by hand:</span>
        <button type="button" className="lineedit-tool" onClick={onAddLine}>
          + Add line
        </button>
        <button type="button" className="lineedit-tool" onClick={onOpenPricebook}>
          From pricebook
        </button>
      </div>
    </div>
  );
}
