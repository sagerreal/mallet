/**
 * components/ui/address-input.tsx
 * Controlled address input with optional Google Places autocomplete.
 *
 * When NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set:
 *   - Debounces 300ms then calls Places API (New) Autocomplete endpoint.
 *   - Renders up to 5 suggestions in-flow, flush under the input.
 *   - Keyboard: ArrowDown/ArrowUp navigate; Enter selects; Escape closes.
 *   - Click selects.
 *   - Selecting a suggestion also fetches the place's LOCATION (lat/lng) via
 *     Place Details (New) — the SAME Places API the autocomplete call uses, so
 *     no extra Google product needs enabling on the key. onSelect receives the
 *     coordinates alongside the address; a failed details fetch passes null and
 *     the caller falls back to its own resolution (e.g. geocoding).
 *   - Fetch errors degrade silently (console.warn dev only); plain input still works.
 *
 * When the key is absent: renders a plain input — no fetch, no list.
 *
 * No new npm packages. Plain fetch + React state only.
 * Owen rule: NO floating/portal/popover UI. Suggestions expand IN-FLOW.
 */

"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";

const PLACES_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";
const MAX_SUGGESTIONS = 5;
const DEBOUNCE_MS = 300;

export interface PlaceLocation {
  lat: number;
  lng: number;
}

interface Suggestion {
  text: string;
  placeId: string | null;
}

/**
 * Fetches the selected place's coordinates via Place Details (New) — location
 * field only. Returns null on any failure (missing id, HTTP error, malformed
 * body); the caller treats null as "resolve the address yourself".
 */
async function fetchPlaceLocation(
  placeId: string,
  apiKey: string,
): Promise<PlaceLocation | null> {
  try {
    const res = await fetch(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location",
      },
    });
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[AddressInput] Place Details error", res.status);
      }
      return null;
    }
    const data = (await res.json()) as {
      location?: { latitude?: number; longitude?: number };
    };
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[AddressInput] Place Details fetch failed", err);
    }
    return null;
  }
}

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Fires when a suggestion is chosen. `location` is the place's coordinates
   * from Place Details, or null when the lookup failed — callers that need a
   * map position fall back to their own geocoding on null.
   */
  onSelect?: (value: string, location: PlaceLocation | null) => void;
  onBlur?: () => void;
  /**
   * Enter pressed with NO suggestion highlighted — i.e. the user typed an address and pressed
   * Enter, which is the ordinary way to say "that's the one".
   *
   * Without this, Enter did nothing unless a dropdown row was selected, and the value survived only
   * if the field happened to blur. A shop typed its office address, reached for the next control,
   * and lost it — the radius beside it saved on every keystroke, so it looked like the address
   * simply "didn't save".
   */
  onCommit?: () => void;
  placeholder?: string;
  className?: string;
  inputStyle?: React.CSSProperties;
  "aria-label"?: string;
  /**
   * Forwarded to the inner `<input>` so a `<label htmlFor>` can reach it — `Field`
   * clones its child with a generated id, and without this the id landed on nothing
   * and the label pointed at a control that did not exist.
   */
  id?: string;
}

export function AddressInput({
  value,
  onChange,
  onSelect,
  onBlur,
  onCommit,
  placeholder,
  className,
  inputStyle,
  "aria-label": ariaLabel,
  id,
}: AddressInputProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const listboxId = useId();
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
          suggestions?: Array<{
            placePrediction?: { text?: { text?: string }; placeId?: string };
          }>;
        };
        const items: Suggestion[] = (data.suggestions ?? [])
          .slice(0, MAX_SUGGESTIONS)
          .map((s) => ({
            text: s.placePrediction?.text?.text ?? "",
            placeId: s.placePrediction?.placeId ?? null,
          }))
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

  function selectSuggestion(suggestion: Suggestion) {
    onChange(suggestion.text);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    if (!onSelect) return;
    const handler = onSelect;
    if (suggestion.placeId && apiKey) {
      // The prediction carries a place id — resolve its coordinates through
      // Place Details so callers get a map position with NO geocode call.
      void fetchPlaceLocation(suggestion.placeId, apiKey).then((location) => {
        handler(suggestion.text, location);
      });
    } else {
      handler(suggestion.text, null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter with nothing highlighted commits what was typed. Checked BEFORE the guard below,
    // which returns early whenever the suggestion list is closed or empty — the exact state a
    // finished address is usually in.
    //
    // Gated on onCommit being PASSED, not merely called: two consumers (new-job, new-customer) put
    // this input inside a <form>, where Enter has always submitted. Swallowing it for them would be
    // an unrelated behaviour change on surfaces that never asked for one.
    if (onCommit && e.key === "Enter" && (!open || suggestions.length === 0 || activeIdx < 0)) {
      e.preventDefault();
      onCommit();
      return;
    }
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
      if (chosen) selectSuggestion(chosen);
    } else if (e.key === "Escape" && open && suggestions.length > 0) {
      // Escape while the list is open closes the LIST, not the modal above it. The Modal shell
      // listens for Escape at the document level, so without stopPropagation this keystroke
      // destroyed the whole form the input sat in (CustomerPicker names the same hazard).
      // With no list open, Escape falls through to the modal — closing it is then what the
      // user meant.
      e.stopPropagation();
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
    // flex + minWidth: the wrapper must grow inside flex rows (e.g. the lead-header
    // address row) or it shrinks to content width and long addresses get cut off.
    <div ref={containerRef} style={{ position: "relative", flex: "1 1 auto", minWidth: 0, width: "100%" }}>
      <input
        type="text"
        id={id}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete={apiKey ? "list" : "none"}
        aria-expanded={open}
        aria-controls={open && suggestions.length > 0 ? listboxId : undefined}
        autoComplete="off"
        style={{ width: "100%", ...inputStyle }}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            margin: "0",
            padding: "0",
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
                selectSuggestion(s);
              }}
              style={{
                padding: "var(--space-2) var(--space-3)",
                fontSize: "var(--type-base)",
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
