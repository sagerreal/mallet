"use client";

/**
 * features/artie/autonomy-row.tsx
 * The one control that sets how much Artie may do without asking — rendered on the Office
 * Settings page (Company tab, alongside the shop's other org-wide behaviour settings).
 *
 * Everything this reads and writes already exists end to end (Task 16): `v1.settings.get`
 * returns `config.agentAutonomy`, and `v1.settings.updateConfig` accepts it — gated server-side to
 * the owner (a FORBIDDEN otherwise). This component is the surface, not the plumbing.
 *
 * Owner-only to CHANGE, never to see: a non-owner gets the picker disabled with a plain reason
 * rather than the row vanishing — a control that disappears reads as broken, per house rule.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useMe } from "@/features/identity/hooks";
import { Card } from "@/components/ui/card";
import { SheetRow } from "@/components/modals/sheet-row";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";

// Matches modules/agent-tasks/domain/autonomy.ts's AutonomyLevel union — kept as a local literal
// here rather than imported, the same DTO≠domain reasoning as settings-dto.ts's own
// `agentAutonomyDTO` (which is what this value actually rides the wire as).
type AutonomyLevel = "supervised" | "assisted" | "autonomous";

interface LevelCopy {
  readonly value: AutonomyLevel;
  readonly label: string;
  readonly consequence: string;
}

// Copy is verbatim from the brief — functional, not chatty, and specific about what stays gated.
const LEVELS: readonly LevelCopy[] = [
  {
    value: "supervised",
    label: "Supervised",
    consequence: "Artie drafts everything and waits for your OK before anything leaves.",
  },
  {
    value: "assisted",
    label: "Assisted",
    consequence:
      "Artie sends routine replies and books work on its own. Prices, payments and anything it can't undo still come to you.",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    consequence:
      "Artie also works on its own initiative and opens its own follow-ups. Prices, payments and anything it can't undo still come to you.",
  },
];

const labelFor = (level: string | undefined): string => LEVELS.find((l) => l.value === level)?.label ?? "…";

export function AutonomyRow() {
  const me = useMe();
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const save = api.v1.settings.updateConfig.useMutation();
  const { saved, flash, reset } = useSaveFlash();
  const [error, setError] = useState<string | null>(null);

  const isOwner = me.data?.role === "owner";
  const current = settings.data?.config.agentAutonomy;
  // Gate on the real value having arrived (same reasoning as TimezoneCard): picking a level before
  // the live one is known risks a click that reads as "already selected" doing nothing.
  const ready = settings.isFetched && !save.isPending;

  const pick = (level: AutonomyLevel): void => {
    if (level === current) return;
    setError(null);
    reset();
    save.mutate(
      { agentAutonomy: level },
      {
        onSuccess: () => {
          void utils.v1.settings.get.invalidate();
          flash();
        },
        onError: (err) => {
          // Verbatim, not the generic role-copy: the FORBIDDEN sentence names the actual rule
          // ("only the owner can change what the assistant may do on its own"), which is the one
          // thing worth saying when a save like this is refused.
          setError(err.message || "Couldn't save. Try again.");
        },
      },
    );
  };

  return (
    // A Card, matching the bordered weight of the settings cards around it — SheetRow itself is
    // the modal-sheet primitive (design-system.md), not a page-level bordered surface, so this is
    // the composition the house rule ("compose primitives, never hand-roll") actually asks for.
    <Card>
      <div className="sheet-rows" style={{ marginTop: 0 }}>
        <SheetRow label="What Artie may do" value={labelFor(current)} expandable>
          {!isOwner && (
            <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-3)" }}>
              Only the owner can change this.
            </p>
          )}
          <div className="segctl" role="group" aria-label="Autonomy level">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                className={current === l.value ? "on" : ""}
                aria-pressed={current === l.value}
                disabled={!isOwner || !ready}
                onClick={() => pick(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <ul className="stack-2" style={{ margin: "var(--space-3) 0 0", padding: 0, listStyle: "none" }}>
            {LEVELS.map((l) => (
              <li key={l.value} style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--ink)" }}>{l.label}.</strong> {l.consequence}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" style={{ color: "var(--red-700, #b42318)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
              {error}
            </p>
          )}
          <SavedFlash saved={saved} />
        </SheetRow>
      </div>
    </Card>
  );
}
