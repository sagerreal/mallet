/**
 * app/(office)/settings/sales-tax-card.tsx
 * The shop's default sales-tax rate — one number, set once.
 *
 * WHY THIS EXISTS. Until now the only place a rate could be authored was the composer's `Tax %`
 * input, which starts empty on every quote. The result, measured against the live database: 830 of
 * 832 invoices carry 0%. A shop that charges tax was retyping it per quote or, far more often,
 * silently not charging it at all — and sales tax is assessed against the SELLER, so an
 * under-collection comes out of the shop's own pocket at audit.
 *
 * One rate per shop, seeded onto each new document and still overridable on that document. That is
 * the Jobber / Housecall Pro model, and it is deliberately not a per-jurisdiction engine: a 1-3
 * technician shop works one metro and knows its own rate.
 *
 * PERCENT ON SCREEN, BASIS POINTS ON THE WIRE. The shop types 8.25; the field stores 825. Two
 * decimal places is exactly the precision US combined rates use.
 */

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { FoldCard } from "./fold-card";

const TITLE = "Sales tax";

/** Cap mirrors the router's `max(2500)`: no US combined rate is close to 25%, so a bigger number
 *  is a typed "825" that lost its decimal point. Rejected here too, for an instant message. */
const MAX_BPS = 2500;

/** 825 → "8.25", 0 → "". Trailing zeros trimmed so a whole percent reads "8", not "8.00". */
export function bpsToPercentText(bps: number): string {
  if (bps <= 0) return "";
  return String(Number((bps / 100).toFixed(2)));
}

/** "8.25" → 825. Returns null when the text is not a usable rate. */
export function percentTextToBps(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, "");
  if (trimmed === "") return 0;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const bps = Math.round(pct * 100);
  return bps > MAX_BPS ? null : bps;
}

export function SalesTaxCard() {
  const settings = api.v1.settings.get.useQuery();
  const save = api.v1.settings.updateConfig.useMutation();
  const utils = api.useUtils();
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  const serverBps = settings.data?.config.taxBps ?? 0;
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);

  // Adopt the server's answer until the shop starts typing, so a late query does not clobber input.
  useEffect(() => {
    if (!touched && settings.data) setDraft(bpsToPercentText(serverBps));
  }, [settings.data, serverBps, touched]);

  if (settings.isLoading) {
    return (
      <FoldCard title={TITLE} summary="Loading…">
        <p className="muted">Loading…</p>
      </FoldCard>
    );
  }

  const parsed = percentTextToBps(draft);
  const invalid = parsed === null;
  const dirty = parsed !== null && parsed !== serverBps;

  const onSave = () => {
    if (parsed === null) return;
    save.mutate(
      { taxBps: parsed },
      {
        onSuccess: () => {
          setTouched(false);
          void utils.v1.settings.get.invalidate();
          flash();
        },
      },
    );
  };

  return (
    <FoldCard title={TITLE} summary={serverBps > 0 ? `${bpsToPercentText(serverBps)}%` : "Not set"}>
      <Field label="Sales tax rate (%)" style={{ margin: 0 }}>
        <Input
          value={draft}
          onChange={(e) => {
            setTouched(true);
            resetSaved();
            setDraft(e.target.value);
          }}
          inputMode="decimal"
          placeholder="8.25"
        />
      </Field>
      <p className="muted" style={{ fontSize: "var(--type-sm)" }}>
        Applied to new quotes and invoices. You can still change it on any one of them.
      </p>
      {invalid && (
        <p className="muted" role="alert">
          Enter a rate between 0 and {MAX_BPS / 100}%.
        </p>
      )}
      {save.isError && (
        <p className="muted" role="alert">
          Couldn&rsquo;t save the rate. Try again.
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <Button onClick={onSave} disabled={!dirty || invalid || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <SavedFlash saved={saved} />
      </div>
    </FoldCard>
  );
}
