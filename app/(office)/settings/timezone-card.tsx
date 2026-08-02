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

import { api } from "@/lib/trpc/client";
import { Field, Select } from "@/components/ui/input";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { FoldCard } from "./fold-card";

const ZONES: readonly (readonly [string, string])[] = [
  ["America/New_York", "Eastern time"],
  ["America/Chicago", "Central time"],
  ["America/Denver", "Mountain time"],
  ["America/Phoenix", "Arizona time"],
  ["America/Los_Angeles", "Pacific time"],
  ["America/Anchorage", "Alaska time"],
  ["Pacific/Honolulu", "Hawaii time"],
  ["America/Puerto_Rico", "Atlantic time"],
];

const DEFAULT_ZONE = "America/Los_Angeles";

function labelFor(zone: string): string {
  return ZONES.find(([value]) => value === zone)?.[1] ?? zone;
}

export function TimezoneCard() {
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const { saved, flash } = useSaveFlash();
  const save = api.v1.settings.updateConfig.useMutation();

  const current = settings.data?.config.timezone ?? DEFAULT_ZONE;

  return (
    <FoldCard title="Time zone" summary={labelFor(current)} defaultOpen>
      <Field label="Time zone">
        <Select
          value={current}
          onChange={(e) =>
            save.mutate(
              { timezone: e.target.value },
              {
                onSuccess: () => {
                  void utils.v1.settings.get.invalidate();
                  flash();
                },
              },
            )
          }
        >
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
      <SavedFlash saved={saved} />
    </FoldCard>
  );
}
