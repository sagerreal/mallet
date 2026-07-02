/**
 * components/modals/lead-modal/visit-card.tsx
 * Faithful port of prototype leadVisitCard(l) (openLead §visit card).
 * Shows site visit(s) on this lead with status pill, day·tech, scopeNotes,
 * photo count, Open / Quote buttons.
 */

"use client";

import type { Lead, Visit } from "@/lib/store/types";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
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
  leadId: number;
  techName: string;
}

function VisitRow({ visit, leadId, techName }: VisitRowProps) {
  const openModal = useOpenModal();

  return (
    <div className="stage-row">
      <span className={`pill ${statusPillCls(visit.status)}`}>{visit.status}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>
          {formatDay(visit)} · {techName}
        </div>
        {visit.scopeNotes && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {visit.scopeNotes}
          </div>
        )}
        {visit.photos && visit.photos.length > 0 && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            {visit.photos.length} photo{visit.photos.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
      <div className="trig" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          className="btn sm ghost"
          onClick={() => openModal(MODAL.VISIT, { visitId: visit.id, leadId })}
        >
          Open
        </button>
        {visit.status !== "done" && (
          <button
            className="btn sm"
            onClick={() => openModal(MODAL.COMPOSER, { leadId, fromVisitId: visit.id })}
          >
            Quote
          </button>
        )}
      </div>
    </div>
  );
}

export function VisitCard({ lead }: VisitCardProps) {
  const techs = useAppStore((s) => s.techs);

  const evisits = lead.evisits ?? [];
  if (evisits.length === 0) return null;

  function techName(techId: number | null): string {
    if (techId == null) return "Unassigned";
    return techs.find((t) => t.id === techId)?.name ?? `Tech ${techId}`;
  }

  return (
    <div className="card">
      <h3>
        Site visit{evisits.length !== 1 ? "s" : ""}{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          — look-first, on this lead until a quote is accepted
        </span>
      </h3>

      {evisits.map((v) => (
        <VisitRow
          key={v.id}
          visit={v}
          leadId={lead.id}
          techName={techName(v.techId)}
        />
      ))}
    </div>
  );
}
