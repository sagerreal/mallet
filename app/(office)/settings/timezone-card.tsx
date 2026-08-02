"use client";

/**
 * Settings → Workspace → Time zone.
 *
 * org_settings.timezone is DERIVED at signup from the ZIP (lib/geo/zip-timezone.ts) — a ZIP3-prefix
 * table, and twelve states straddle a timezone line (FL, IN, KY, TN, ND, SD, NE, KS, TX, MI, OR,
 * ID). A shop on the wrong side of one of those lines gets the wrong zone, and nothing in the app
 * could correct org_settings.timezone before this card existed. It is the correction path, not an
 * afterthought — which is also why the derivation never applies silently (see the ZIP helper).
 *
 * Same plain-name labels as the /welcome ZIP-derivation preview: a shop reads "Eastern", not
 * "America/New_York".
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Field, Select } from "@/components/ui/input";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { userMessage } from "@/lib/trpc/error-map";
import { TZ_LABEL } from "@/lib/geo/zip-timezone";
import { FoldCard } from "./fold-card";

// Single source of truth: TZ_LABEL (lib/geo/zip-timezone.ts) is also what /welcome's derivation
// preview reads. A third, independently-maintained zone list here is exactly how this control used
// to end up unable to render an option for a zone the ZIP table already knew about.
const ZONES: readonly (readonly [string, string])[] = Object.entries(TZ_LABEL);

const DEFAULT_ZONE = "America/Los_Angeles";

function labelFor(zone: string): string {
  return TZ_LABEL[zone] ?? zone;
}

export function TimezoneCard() {
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const { saved, flash } = useSaveFlash();
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = api.v1.settings.updateConfig.useMutation();

  // Gate on the real value having arrived. Rendering DEFAULT_ZONE as a live, editable,
  // apparently-confirmed Select value while the query is still in flight would show a confident
  // wrong answer nobody was asked to check — the exact failure this card exists to correct (see
  // the file comment). Matches the sibling pattern in quickbooks-card.tsx / payments-card.tsx
  // (`status.isLoading ? "Loading…" : …`).
  if (!settings.isFetched) {
    return (
      <FoldCard title="Time zone" summary="Loading…" defaultOpen>
        <p className="muted" style={{ fontSize: "var(--type-base)", margin: 0 }}>
          Loading…
        </p>
      </FoldCard>
    );
  }

  const current = settings.data?.config.timezone ?? DEFAULT_ZONE;
  // A stored zone the ZIP table (and this list) doesn't know about must still show up as ITSELF,
  // not fall through to a blank selection — that would hide the exact value this control exists to
  // let someone see and correct.
  const currentIsKnown = ZONES.some(([value]) => value === current);

  return (
    <FoldCard title="Time zone" summary={labelFor(current)} defaultOpen>
      <Field label="Time zone">
        <Select
          value={current}
          onChange={(e) => {
            setSaveError(null);
            save.mutate(
              { timezone: e.target.value },
              {
                onSuccess: () => {
                  void utils.v1.settings.get.invalidate();
                  flash();
                },
                onError: (err) => {
                  setSaveError(userMessage(err, "Couldn't save the time zone — try again."));
                },
              },
            );
          }}
        >
          {!currentIsKnown && (
            <option key={current} value={current}>
              {current}
            </option>
          )}
          {ZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
        Used by the front desk when it offers appointment times, and by the assistant when it says
        &ldquo;today&rdquo;.
      </p>
      {saveError && (
        <p role="alert" style={{ color: "var(--red-700, #b42318)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          {saveError}
        </p>
      )}
      <SavedFlash saved={saved} />
    </FoldCard>
  );
}
