/**
 * components/modals/lead-modal/visit-card.tsx
 * Faithful port of prototype leadVisitCard(l) (openLead §visit card).
 * Shows site visit(s) on this lead with status pill, day·tech, scopeNotes,
 * photo count, Open / Quote buttons.
 */

"use client";

import { useRouter } from "next/navigation";
import type { Lead, Visit } from "@/lib/store/types";
import { useAppStore, usePushModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface VisitCardProps {
  lead: Lead;
}

function statusPillCls(status: string): string {
  if (status === "done") return "green";
  if (status === "scheduled") return "blue";
  return "gray";
}

function formatDay(visit: Visit): string {
  if (visit.date == null || visit.start == null) return "Not scheduled";
  const hour = visit.start;
  const ampm = hour >= 12 ? "pm" : "am";
  const displayHour = hour > 12 ? hour - 12 : hour;
  return `${visit.date} · ${displayHour}${ampm}`;
}

interface VisitRowProps {
  visit: Visit;
  leadId: string;
  techName: string;
}

function VisitRow({ visit, leadId, techName }: VisitRowProps) {
  const pushModal = usePushModal();
  const closeModal = useCloseModal();
  const router = useRouter();

  // "Quote" → the real composer, pre-populated with this customer.
  function quote() {
    closeModal();
    router.push(`/composer?lead=${leadId}`);
  }

  // Photos ride the subtitle as a count — information, not decoration: a tech
  // checking the slab-leak photo should not have to tap in blind to learn it exists.
  const sub = [
    visit.scopeNotes,
    visit.photos && visit.photos.length > 0
      ? `${visit.photos.length} photo${visit.photos.length !== 1 ? "s" : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      className="sheet-workrow"
      onClick={() => pushModal(MODAL.EVISIT, { leadId, visitId: visit.id })}
    >
      <div className="t">
        <b>Site visit — {formatDay(visit)} · {techName}</b>
        {sub && <span>{sub}</span>}
      </div>
      <span className={`pill ${statusPillCls(visit.status)}`}>{sentenceCase(visit.status)}</span>
      {visit.status !== "done" && (
        <span
          className="btn sm"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            quote();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              quote();
            }
          }}
        >
          Quote
        </span>
      )}
      <span className="chev" style={{ color: "var(--ink-3)" }} aria-hidden="true">›</span>
    </button>
  );
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function VisitRows({ lead }: VisitCardProps) {
  const techs = useAppStore((s) => s.techs);

  const evisits = lead.evisits ?? [];
  if (evisits.length === 0) return null;

  function techName(techId: string | null): string {
    if (techId == null) return "Unassigned";
    return techs.find((t) => t.id === techId)?.name ?? `Tech ${techId}`;
  }

  return (
    <>
      {evisits.map((v) => (
        <VisitRow
          key={v.id}
          visit={v}
          leadId={lead.id}
          techName={techName(v.techId)}
        />
      ))}
    </>
  );
}
