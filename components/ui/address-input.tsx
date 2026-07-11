/**
 * components/ui/address-input.tsx
 * Controlled address input with optional Google Places autocomplete.
 *
 * When NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set:
 *   - Debounces 300ms then calls Places API (New) Autocomplete endpoint.
 *   - Renders up to 5 suggestions in-flow, flush under the input.
 *   - Keyboard: ArrowDown/ArrowUp navigate; Enter selects; Escape closes.
 *   - Click selects.
 *   - Fetch errors degrade silently (console.warn dev only); plain input still works.
 *
 * When the key is absent: renders a plain input — no fetch, no list.
 *
 * No new npm packages. Plain fetch + React state only.
 * Owen rule: NO floating/portal/popover UI. Suggestions expand IN-FLOW.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const PLACES_URL = "https://places.googleapis.com/v1/places:autocomplete";
const MAX_SUGGESTIONS = 5;
const DEBOUNCE_MS = 300;

interface Suggestion {
  text: string;
}

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  inputStyle?: React.CSSProperties;
  "aria-label"?: string;
}

export function AddressInput({
  value,
  onChange,
  onSelect,
  onBlur,
  placeholder,
  className,
  inputStyle,
  "aria-label": ariaLabel,
}: AddressInputProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!apiKey || input.trim().length < 2) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      try {
        const res = await fetch(PLACES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
          },
          body: JSON.stringify({ input, includedRegionCodes: ["us"] }),
        });
        if (!res.ok) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[AddressInput] Places API error", res.status);
          }
          setSuggestions([]);
          setOpen(false);
          return;
        }
        const data = (await res.json()) as {
          suggestions?: Array<{ placePrediction?: { text?: { text?: string } } }>;
        };
        const items: Suggestion[] = (data.suggestions ?? [])
          .slice(0, MAX_SUGGESTIONS)
          .map((s) => ({ text: s.placePrediction?.text?.text ?? "" }))
          .filter((s) => s.text.length > 0);
        setSuggestions(items);
        setOpen(items.length > 0);
        setActiveIdx(-1);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[AddressInput] fetch failed, falling back to plain input", err);
        }
        setSuggestions([]);
        setOpen(false);
      }
    },
    [apiKey],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    if (!apiKey) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(v);
    }, DEBOUNCE_MS);
  }

  function selectSuggestion(text: string) {
    onChange(text);
    onSelect?.(text);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const chosen = suggestions[activeIdx];
      if (chosen) selectSuggestion(chosen.text);
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  // Close on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
        aria-autocomplete={apiKey ? "list" : "none"}
        aria-expanded={open}
        autoComplete="off"
        style={inputStyle}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            margin: 0,
            padding: 0,
            listStyle: "none",
            background: "var(--surface, #fff)",
            border: "1px solid var(--line, #e0e0e0)",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.text}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                // Prevent blur before click registers.
                e.preventDefault();
                selectSuggestion(s.text);
              }}
              style={{
                padding: "9px 12px",
                fontSize: 13.5,
                cursor: "pointer",
                background: i === activeIdx ? "var(--surface-2, #f5f5f5)" : "transparent",
                color: "var(--ink, #111)",
                borderBottom: i < suggestions.length - 1 ? "1px solid var(--line-2, #f0f0f0)" : "none",
              }}
            >
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
