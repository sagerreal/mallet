/**
 * components/modals/site-tracer/site-surface-controls.tsx
 * The Flat | Pitched segmented control and, for pitched surfaces, the pitch
 * preset row (4/12 6/12 8/12 10/12 + custom rise). Shared by the new-trace
 * form and the saved-capture view so both surfaces speak the same grammar.
 *
 * Controlled + presentational: parents own the state and persistence.
 */

"use client";

import { useState } from "react";
import {
  PITCH_PRESETS,
  pitchLabel,
  parsePitchInput,
} from "@/lib/measure/aerial-geometry";

interface SurfaceToggleProps {
  surface: "flat" | "pitched";
  onChange: (surface: "flat" | "pitched") => void;
}

export function SurfaceToggle({ surface, onChange }: SurfaceToggleProps) {
  return (
    <div className="seg" role="group" aria-label="Surface type">
      <button
        type="button"
        aria-pressed={surface === "flat"}
        onClick={() => onChange("flat")}
      >
        Flat
      </button>
      <button
        type="button"
        aria-pressed={surface === "pitched"}
        onClick={() => onChange("pitched")}
      >
        Pitched
      </button>
    </div>
  );
}

interface PitchRowProps {
  pitchRise: number;
  onChange: (pitchRise: number) => void;
}

export function PitchRow({ pitchRise, onChange }: PitchRowProps) {
  const isPreset = PITCH_PRESETS.includes(pitchRise);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : String(pitchRise));
  const [error, setError] = useState<string | null>(null);

  function pickPreset(rise: number) {
    setCustomOpen(false);
    setDraft("");
    setError(null);
    onChange(rise);
  }

  function commitCustom() {
    if (draft.trim() === "") return; // nothing typed — keep the current pitch
    const parsed = parsePitchInput(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onChange(parsed.value);
  }

  return (
    <div>
      <div className="seg" role="group" aria-label="Pitch">
        {PITCH_PRESETS.map((rise) => (
          <button
            key={rise}
            type="button"
            aria-pressed={!customOpen && pitchRise === rise}
            onClick={() => pickPreset(rise)}
          >
            {pitchLabel(rise)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={customOpen}
          onClick={() => {
            setCustomOpen(true);
            setDraft(String(pitchRise));
          }}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <label
            className="muted"
            style={{ display: "block", marginBottom: "var(--space-1)" }}
            htmlFor="tracer-custom-pitch"
          >
            Rise per 12
          </label>
          <input
            id="tracer-custom-pitch"
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCustom();
              }
            }}
          />
        </div>
      )}

      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
