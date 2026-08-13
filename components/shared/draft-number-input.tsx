"use client";

/**
 * A number input that can actually be TYPED in. The controlled parse-on-keystroke pattern
 * re-rendered parseFloat(value) after every key: "13." lost its dot, "0.5" collapsed to "",
 * and a swallowed decimal point silently turned "2.0" into 20 — a 20% sales tax the user never
 * set, stored on a real invoice. While focused the field holds the raw string draft and commits
 * the parsed number per keystroke; the parent's canonical value takes back over on blur.
 *
 * type="text" + inputMode="decimal", deliberately: number inputs bring their own value
 * normalization, which is the exact behavior being removed.
 */

import { useState, type CSSProperties } from "react";

export interface DraftNumberInputProps {
  /** Canonical value from the parent — what renders when the field is not being edited. */
  readonly value: number;
  /**
   * Parsed (never NaN, floored at 0) on every keystroke. The parent owns any clamping.
   * Optional: a field whose only commit is expensive wants `onSettle` alone, not a noop here.
   */
  readonly onCommit?: (n: number) => void;
  /**
   * Fired ONCE on blur, for a commit too expensive to do per keystroke — a server write, not a
   * store update. Typing "125" with a per-keystroke persist wrote $1 and then $12 to the shop's
   * settings on the way, so navigating away mid-type left the fee at $1.
   *
   * Skipped when the field was merely cleared: select-all + delete is an ordinary "let me retype
   * this" gesture, and treating it as a decision to store 0 gave no undo. A deliberate zero is
   * still settled — it just has to be typed.
   */
  readonly onSettle?: (n: number) => void;
  /** Fixed decimals for the at-rest rendering (e.g. 2 for money). Trimmed naturally when unset. */
  readonly decimals?: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly "aria-label": string;
  readonly style?: CSSProperties;
}

const parse = (raw: string): number => {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function DraftNumberInput({
  value,
  onCommit,
  onSettle,
  decimals,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
  style,
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const atRest = value === 0 ? "" : decimals !== undefined ? value.toFixed(decimals) : String(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? atRest}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => setDraft(atRest)}
      onChange={(ev) => {
        setDraft(ev.target.value);
        onCommit?.(parse(ev.target.value));
      }}
      onBlur={() => {
        // Settle only a real change. A blank draft is a cleared box, not a typed 0 — treating it
        // as one stored $0 with no undo. And an unchanged value is not worth a server round trip,
        // so tabbing through the field writes nothing.
        if (onSettle && draft !== null && draft.trim() !== "" && parse(draft) !== value) {
          onSettle(parse(draft));
        }
        setDraft(null);
      }}
      style={style}
    />
  );
}
