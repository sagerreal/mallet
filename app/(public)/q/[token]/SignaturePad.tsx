"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Draw-your-signature field for the public quote page.
 *
 * SVG, not canvas. The mark is stored as a path string, so it is a few hundred bytes of text that
 * goes straight into a column, renders at any size on a PDF or a courtroom printout, and survives
 * being read back years later. A canvas would mean a base64 PNG — bigger, resolution-locked, and
 * meaningless to anyone inspecting the row.
 *
 * POINTER EVENTS, not mouse. Most people sign this on a phone with a finger. Pointer events cover
 * mouse, touch and stylus in one path, and setPointerCapture is what keeps the stroke attached when
 * the finger slides outside the box mid-signature — without it the line simply stops.
 *
 * touch-action: none is load-bearing on mobile: without it the browser treats the drag as a scroll
 * and the customer scrolls the page instead of signing.
 */

export interface SignaturePadProps {
  readonly value: string;
  readonly onChange: (svgPath: string) => void;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

const WIDTH = 600;
const HEIGHT = 180;

export function SignaturePad({ value, onChange, disabled = false, ...aria }: SignaturePadProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  // The stroke being drawn right now, kept in state so it renders live; committed into `value` on
  // release. Separate from `value` so a completed signature is never partially rewritten.
  const [current, setCurrent] = useState("");

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>): string | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    // A zero-size box would divide by zero and put Infinity in the path — which stores fine and
    // renders as nothing, so the shop would hold a signature record that proves absolutely
    // nothing while looking complete. Happens when the pad is measured before layout settles.
    if (r.width === 0 || r.height === 0) return null;
    // Scale from CSS pixels into the viewBox, so the stored path is resolution-independent and
    // does not change shape when the box is rendered at a different width.
    const x = ((e.clientX - r.left) / r.width) * WIDTH;
    const y = ((e.clientY - r.top) / r.height) * HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const start = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    drawing.current = true;
    // Keeps the stroke alive when the finger leaves the box mid-signature. Guarded because it
    // throws on a pointer id the element never saw — a real case when a touch is cancelled by the
    // OS mid-gesture, and losing the whole signature to an exception is worse than losing capture.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Non-fatal: drawing still works, the stroke just ends if the pointer leaves the box.
    }
    const p = pointAt(e);
    if (p !== null) setCurrent(`M${p}`);
  };

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing.current || disabled) return;
    const p = pointAt(e);
    // Skip unmeasurable points rather than writing a broken segment into an otherwise good stroke.
    if (p === null) return;
    setCurrent((c) => (c ? `${c} L${p}` : `M${p}`));
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setCurrent((c) => {
      // A tap with no movement is not a signature — discard it rather than storing a dot that
      // would satisfy the "did they draw something" check while proving nothing.
      if (!c.includes("L")) return "";
      onChange(value ? `${value} ${c}` : c);
      return "";
    });
  };

  const clear = () => {
    setCurrent("");
    onChange("");
  };

  const hasMark = value.length > 0 || current.length > 0;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="img"
        aria-label={aria["aria-label"] ?? "Signature"}
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: `${WIDTH} / ${HEIGHT}`,
          border: "1.5px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          background: "var(--card)",
          // Without this the browser treats the drag as a scroll and the page moves instead of
          // the pen — the single most common way a signature pad fails on a phone.
          touchAction: "none",
          cursor: disabled ? "not-allowed" : "crosshair",
          display: "block",
        }}
      >
        {/* Sign-here rule, so the box reads as somewhere to write rather than an empty panel. */}
        <line
          x1="24"
          y1={HEIGHT - 44}
          x2={WIDTH - 24}
          y2={HEIGHT - 44}
          stroke="var(--line)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        {value && <path d={value} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {current && <path d={current} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--type-sm)", color: "var(--ink-3)" }}>
          {/* Says "optional" out loud. Without it the empty box reads as a required step, and
              anyone who cannot draw — trackpad, screen reader, no pointer at all — would think
              they were blocked when the typed name above has already signed the document. */}
          {hasMark ? "Drawn signature added" : "Draw your signature (optional)"}
        </span>
        {hasMark && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              fontFamily: "inherit",
              fontSize: "var(--type-sm)",
              color: "var(--ink-2)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
