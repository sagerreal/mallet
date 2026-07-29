"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

/**
 * The app's own dropdown, replacing the browser's native `<select>`.
 *
 * A native select renders its list with the OPERATING SYSTEM, not with our CSS — blue macOS
 * highlight, system font, system metrics, ignoring every token in the design system. It is the one
 * control in the app that cannot be styled at all, so on any screen with a select next to a real
 * Mallet control the two do not look like the same product.
 *
 * ANCHORED, NOT FLOATING. The list is absolutely positioned inside a relative wrapper, flush under
 * the trigger — the same shape address-input.tsx already uses for its suggestions, and what the
 * house rule means by "suggestion lists render under their input". No portal, no detached inset.
 *
 * KEYBOARD PARITY IS THE POINT. A native select is fully operable without a mouse, so a
 * replacement that is not would be a downgrade dressed as a polish pass. Arrow keys move,
 * Home/End jump, Enter/Space commit, Escape cancels and restores, Tab closes and moves on, and
 * typing a letter jumps to the next option starting with it — the type-ahead people use without
 * noticing until it is gone.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectMenuProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** Shown when `value` matches no option — the native placeholder equivalent. */
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Required when there is no visible <label> pointing at this control. */
  readonly "aria-label"?: string;
  /** id of a visible label, for Field-wrapped call sites. */
  readonly "aria-labelledby"?: string;
  /** Matches COMPACT_INPUT's tighter treatment for dense surfaces. */
  readonly compact?: boolean;
  readonly style?: CSSProperties;
}

const TYPEAHEAD_RESET_MS = 700;

export function SelectMenu({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  compact = false,
  style,
  ...aria
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });
  const listboxId = useId();

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = selectedIdx >= 0 ? options[selectedIdx] : undefined;

  // Close on an outside press. mousedown rather than click so the menu is gone before the click
  // lands on whatever is underneath — otherwise the first click outside only dismisses.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the active option in view when arrowing through a long list (trades, hours, timezones).
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    // Guarded: scrollIntoView is absent in jsdom and on older engines, and keeping the active
    // option visible is an enhancement — a menu that throws is worse than one that does not scroll.
    const el = listRef.current?.children[activeIdx];
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIdx]);

  const openAt = (idx: number) => {
    setActiveIdx(idx);
    setOpen(true);
  };

  const commit = (idx: number) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  // Skip disabled options rather than landing on one and appearing stuck.
  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
      if (!options[i]?.disabled) return i;
    }
    return from;
  };
  const firstEnabled = () => (options.findIndex((o) => !o.disabled) === -1 ? 0 : options.findIndex((o) => !o.disabled));
  const lastEnabled = () => {
    for (let i = options.length - 1; i >= 0; i--) if (!options[i]?.disabled) return i;
    return 0;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (!open) {
      // Down/Up/Enter/Space all open, matching a native select.
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openAt(selectedIdx >= 0 ? selectedIdx : firstEnabled());
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => step(i < 0 ? -1 : i, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => step(i < 0 ? options.length : i, -1));
        return;
      case "Home":
        e.preventDefault();
        setActiveIdx(firstEnabled());
        return;
      case "End":
        e.preventDefault();
        setActiveIdx(lastEnabled());
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(activeIdx);
        return;
      case "Escape":
        e.preventDefault();
        // Cancel, not commit — the value the user arrowed past must not stick.
        setOpen(false);
        return;
      case "Tab":
        // Do NOT preventDefault: closing and letting focus move on is what a native select does.
        setOpen(false);
        return;
      default:
        break;
    }

    // Type-ahead: "ga" jumps to "Garage door". Buffer resets after a pause so a later "g" starts
    // a fresh search rather than extending a stale one.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at > TYPEAHEAD_RESET_MS ? e.key : t.buffer + e.key;
      t.at = now;
      const q = t.buffer.toLowerCase();
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
      if (hit >= 0) setActiveIdx(hit);
    }
  };

  const trigger: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: compact ? "var(--type-base)" : "var(--type-md)",
    padding: compact ? "var(--space-2) var(--space-3)" : "var(--space-3) var(--space-3)",
    borderRadius: compact ? "var(--radius-sm)" : "var(--radius-md)",
    border: "1.5px solid var(--line)",
    background: disabled ? "var(--bg)" : "var(--card)",
    color: selected ? "var(--ink)" : "var(--ink-3)",
    cursor: disabled ? "not-allowed" : "pointer",
    ...style,
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIdx >= 0 ? selectedIdx : firstEnabled()))}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        // On the BUTTON, not the list: aria-activedescendant must sit on whatever holds focus,
        // and focus never leaves the trigger — that is what lets the arrow keys drive the list
        // while the button stays the tab stop.
        aria-activedescendant={open && activeIdx >= 0 ? `${listboxId}-${activeIdx}` : undefined}
        style={trigger}
        {...aria}
      >
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: "var(--type-sm)", color: "var(--ink-3)" }}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            margin: 0,
            padding: 0,
            listStyle: "none",
            maxHeight: "16rem",
            overflowY: "auto",
            background: "var(--card)",
            border: "1.5px solid var(--line)",
            borderTop: "none",
            borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              // mousedown, not click: the button keeps focus and the list closes before the
              // press completes, so a click never lands on what is underneath.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(i);
              }}
              onMouseEnter={() => !o.disabled && setActiveIdx(i)}
              style={{
                padding: compact ? "var(--space-2) var(--space-3)" : "var(--space-2) var(--space-3)",
                fontSize: compact ? "var(--type-base)" : "var(--type-md)",
                cursor: o.disabled ? "not-allowed" : "pointer",
                color: o.disabled ? "var(--ink-3)" : "var(--ink)",
                background: i === activeIdx ? "var(--manila-2)" : "transparent",
                fontWeight: o.value === value ? 700 : 400,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <span aria-hidden="true" style={{ width: "1em", flexShrink: 0, color: "var(--accent)" }}>
                {o.value === value ? "✓" : ""}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
