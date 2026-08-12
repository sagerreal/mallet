/**
 * components/modals/pricing/signed-record-row.tsx
 * The signed document, ON the tech sheet's Quote tab — Owen, looking at a sold job's
 * "SOLD — SIGNED · $200" read-back: "i should probably be able to see the signed
 * quote on this page?" The price was there; the evidence wasn't.
 *
 * A DisclosureRow so the record does not shove the change-order machinery below the
 * fold: collapsed it is one line ("Signed · Dana Alvarez · Aug 12"), expanded it is
 * the SAME SignatureRecord the office job sheet and the quote sheet render — the
 * frozen snapshot, never the live rows.
 *
 * Two signing directions, two sources:
 *   - field sign (signQuote)     → the signature lives on the JOB record;
 *   - web-page sign (sent quote) → it lives on the ESTIMATE, and the job carries
 *     only the pointer (sourceEstimateId). When neither record is in hand, an
 *     OFFICE viewer gets the pointer as a row — "View the signed quote →" opens
 *     the quote sheet, which fetches the full record and shows the same block.
 *     A technician gets no dead link to an office sheet their shell cannot load.
 */

"use client";

import { useState } from "react";
import { useAppStore, usePushModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { useMe } from "@/features/identity/hooks";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { SignatureRecord } from "@/components/shared/signature-record";
import type { Job } from "@/lib/store/types";

/** "Aug 12" — the collapsed row's whole date budget; the full stamp lives inside. */
const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function SignedRecordRow({ job }: { job: Job }) {
  const estimates = useAppStore((s) => s.estimates);
  const pushModal = usePushModal();
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";
  const [open, setOpen] = useState(false);

  // The job's own on-glass signature first; else the source quote's, when a prior
  // open of the quote sheet already pulled the full estimate into the store.
  const sourceEst = job.sourceEstimateId
    ? estimates.find((e) => e.id === job.sourceEstimateId)
    : undefined;
  const signature = job.signature ?? sourceEst?.signature;

  if (signature) {
    return (
      <div style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        <DisclosureRow
          label="Signed"
          value={`${signature.signerName} · ${shortDay(signature.signedAt)}`}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        >
          <SignatureRecord signature={signature} />
        </DisclosureRow>
      </div>
    );
  }

  // No record in hand — the office gets the pointer to the sheet that has it. The words
  // branch on the list-hydrated `signed` flag: a quote can be ACCEPTED without a signature
  // (a verbal yes the office marked), and "signed" on that row would be the exact overclaim
  // the evidence block exists to prevent.
  if (isOffice && job.sourceEstimateId) {
    const estId = job.sourceEstimateId;
    const label = sourceEst?.signed === false ? "Sold from a quote" : "The signed quote is on file";
    return (
      <button
        type="button"
        className="jaddr"
        style={{ width: "100%", textAlign: "left", margin: "var(--space-2) 0 var(--space-4)" }}
        onClick={() => pushModal(MODAL.EST, { estId })}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
        <span className="nav">View →</span>
      </button>
    );
  }

  return null;
}
