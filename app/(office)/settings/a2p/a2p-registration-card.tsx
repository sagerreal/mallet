"use client";

/**
 * Settings → Workspace → Texting (A2P 10DLC) card. The entry point to the guided
 * registration wizard: reads the org's registration status from the store
 * (A2pHydrator seeds it from v1.a2p.getStatus) and renders exactly one of four
 * affordances per docs/design-system.md's mutually-exclusive-state convention:
 *
 *   - needsInput (not_started / failed): a "Set up texting" (or "Try again" when
 *     failed, with the failure reason shown) CTA that reveals the business form
 *     in-flow — no floating UI.
 *   - pending (collecting / profile_pending / brand_pending / campaign_pending /
 *     number_pending): a quiet "Being approved — usually same day" status line.
 *     Nothing to do here; Twilio/TCR review is async (see AdvanceA2pRegistrationUseCase).
 *   - active: "Texting active ✓".
 *
 * While a2pStatus is still null (pre-hydration), the card renders its collapsed
 * summary only — no affordance flashes before the real status is known.
 */

import { useState } from "react";
import { useA2pStatus } from "@/lib/store/app-store";
import { FoldCard } from "../fold-card";
import { Button } from "@/components/ui/button";
import { A2pBusinessForm } from "./a2p-business-form";
import type { A2pStatusView } from "@mallet/a2p";

function summaryFor(status: A2pStatusView | null): string {
  if (!status) return "…";
  if (status.canText) return "Active";
  if (status.needsInput) return status.status === "failed" ? "Needs attention" : "Not set up";
  return "Pending approval";
}

export function A2pRegistrationCard() {
  const status = useA2pStatus();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <FoldCard title="Texting (A2P 10DLC)" summary={summaryFor(status)} defaultOpen>
      {status && status.needsInput && (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {status.status === "failed" && (
            <p style={{ color: "var(--red-700, #b42318)", fontSize: "var(--type-sm)", margin: 0 }} role="alert">
              {status.failureReason ?? "Registration failed — try again."}
            </p>
          )}
          <p className="muted" style={{ fontSize: "var(--type-base)", margin: 0 }}>
            Register your business number for texting so quotes, reminders, and invoices can send
            by SMS. Mallet pre-fills what it can and submits the registration for you.
          </p>
          <div>
            <Button onClick={() => setFormOpen((v) => !v)}>
              {status.status === "failed" ? "Try again" : "Set up texting"}
            </Button>
          </div>
          {formOpen && <A2pBusinessForm onSubmitted={() => setFormOpen(false)} />}
        </div>
      )}

      {status && !status.needsInput && !status.canText && (
        <p className="muted" style={{ fontSize: "var(--type-base)", margin: 0 }}>
          Being approved — usually same day. We&apos;ll switch texting on automatically once
          Twilio/TCR approve the campaign.
        </p>
      )}

      {status && status.canText && (
        <p style={{ fontSize: "var(--type-base)", fontWeight: 600, margin: 0 }}>
          Texting active ✓
        </p>
      )}
    </FoldCard>
  );
}
