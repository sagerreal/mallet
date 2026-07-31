"use client";

/**
 * features/settings/callback-number-form.tsx
 *
 * The mobile Mallet rings FIRST on an outbound click-to-call: we ring you, you answer, and only
 * then is the customer bridged in with the shop's business line as the caller ID. Without a number
 * here, pressing Call cannot do anything.
 *
 * The form itself, shell-free, because it has two homes: the office Settings card and the
 * technician's Account page. A technician can place calls too and has no Settings page, so the
 * setting has to live wherever the person who needs it actually is.
 */

import { useState } from "react";
import { Phone } from "@mallet/shared/types";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import { formatPhone } from "@/lib/phone";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { COMPACT_INPUT } from "@/components/ui/input";

export const CALLBACK_NUMBER_NOT_SET = "Not set";

/** What the caller sees in a collapsed header / summary row. */
export function useCallbackNumberSummary(): string {
  const { data: me } = api.v1.identity.me.useQuery();
  return formatPhone(me?.callbackNumber) || CALLBACK_NUMBER_NOT_SET;
}

// Matches the sibling account fields (Your name / Branding): the shared compact input plus the
// settings-row border, defined once rather than hand-rolled per control.
const inputStyle = {
  ...COMPACT_INPUT,
  flex: 1,
  minWidth: 180,
  border: "1.5px solid var(--line)",
  fontFamily: "inherit",
} as const;

export function CallbackNumberForm() {
  const { data: me } = api.v1.identity.me.useQuery();
  const utils = api.useUtils();
  const stored = me?.callbackNumber ?? null;

  // Draft is local until Save so an invalidate mid-typing cannot yank the field out from under
  // the user. `null` means "not edited yet" — fall back to what is stored.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  const setCallbackNumber = api.v1.calls.setCallbackNumber.useMutation({
    onSuccess: () => {
      setError(null);
      setDraft(null);
      utils.v1.identity.me.invalidate().catch(() => {});
      flash();
    },
    onError: (err) => setError(userMessage(err)),
  });

  const value = draft ?? formatPhone(stored);
  const busy = setCallbackNumber.isPending;

  function edit(next: string) {
    setDraft(next);
    resetSaved();
    setError(null);
  }

  function clear() {
    resetSaved();
    setError(null);
    setCallbackNumber.mutate({ callbackNumber: null });
  }

  function save() {
    const trimmed = value.trim();
    // Saving an empty box is a deliberate clear, not an error.
    if (!trimmed) {
      clear();
      return;
    }
    // Same value object the call endpoint parses with, so this never accepts a number that
    // `place` would later reject.
    if (!Phone.parse(trimmed).ok) {
      setError("That number doesn't look right — 10 digits, US.");
      return;
    }
    resetSaved();
    setCallbackNumber.mutate({ callbackNumber: trimmed });
  }

  return (
    <>
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginBottom: "var(--space-2)" }}>
        The phone Elas rings first when you press Call. Your customer sees the business line,
        never this number.
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="tel"
          aria-label="Your callback number"
          placeholder="(925) 555-0123"
          value={value}
          onChange={(e) => edit(e.target.value)}
          style={inputStyle}
        />
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        {stored && (
          <button className="btn ghost" disabled={busy} onClick={clear}>
            Clear
          </button>
        )}
        <SavedFlash saved={saved} />
      </div>
      {error && (
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          {error}
        </div>
      )}
    </>
  );
}
