/**
 * components/modals/visit-modal.tsx
 * Functional "Book a visit" sheet (prototype openVisitSheet) — the real booking
 * flow off a lead: pick the type (Job vs Estimate visit), describe the work, set
 * day / crew / start / hours, and book it. Estimate visit → a scheduled evisit on
 * the lead; Job → a job with a scheduled visit. Then it opens the created record.
 */

"use client";

import { useMemo, useState } from "react";
import {
  useAppStore,
  useActiveModal,
  useCloseModal,
  useOpenModal,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { TODAY_ISO } from "@/lib/prototype-sample";
import type { Lead } from "@/lib/store/types";

// ---- time + intent helpers (prototype hToTime / timeToH / qaPurposeGuess) ---

function hToTime(h: number): string {
  const hr = Math.floor(h);
  const mn = Math.round((h - hr) * 60);
  return `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}

function timeToH(s: string): number {
  const [hStr, mStr] = s.split(":");
  const hr = Number(hStr) || 0;
  const mn = Number(mStr) || 0;
  return hr + mn / 60;
}

/** Guess the visit type from the request wording (prototype qaPurposeGuess). */
function guessPurpose(txt: string): "fix" | "look" {
  const t = (txt || "").toLowerCase();
  if (!t.trim()) return "fix";
  if (/looks like|maybe|not sure|might be|possibl|no idea|i think|\?|diagnos|take a look|come look|quote|estimate|bid|install|replace/.test(t)) {
    return "look";
  }
  return "fix";
}

type Purpose = "fix" | "look";

export function VisitModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();

  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);
  const addEvisit = useAppStore((s) => s.addEvisit);
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const placeVisit = useAppStore((s) => s.placeVisit);
  const updateLead = useAppStore((s) => s.updateLead);

  const leadId = activeModal?.params?.leadId as number | undefined;
  const lead: Lead | undefined = leads.find((l) => l.id === leadId);

  const firstTechId = techs[0]?.id ?? 1;
  const initialPurpose = useMemo(() => guessPurpose(lead?.job ?? ""), [lead?.job]);

  const [purpose, setPurpose] = useState<Purpose>(initialPurpose);
  const [jobDesc, setJobDesc] = useState(lead?.job ?? "");
  const [day, setDay] = useState<string>(TODAY_ISO);
  const [techId, setTechId] = useState<number>(firstTechId);
  const [start, setStart] = useState<number>(9);
  const [dur, setDur] = useState<number>(initialPurpose === "look" ? 0.5 : 1.5);

  if (!lead) return null;

  function setType(p: Purpose) {
    setPurpose(p);
    // nudge the default duration to the visit kind (scope is quick, a job longer)
    setDur(p === "look" ? 0.5 : 1.5);
  }

  function book() {
    if (!lead) return;
    const desc = jobDesc.trim() || lead.job || "Site visit";

    if (purpose === "look") {
      // Estimate visit — a scheduled evisit on the lead (scope first, quote after).
      addEvisit(lead.id, {
        date: day,
        techId,
        start,
        dur,
        status: "scheduled",
        scopeNotes: desc,
      });
      updateLead(lead.id, { job: desc });
      close();
      openModal(MODAL.LEAD, { leadId: lead.id });
      return;
    }

    // Job — a real job with a scheduled visit (diagnosed & priced on the visit).
    const job = addJob({
      leadId: lead.id,
      svc: "service",
      origin: "manual",
      title: desc,
      addr: lead.address ?? "",
      phone: lead.phone ?? "",
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: "",
      acts: [],
      visits: [],
    });
    const visit = addVisit(job.id, dur);
    if (visit) placeVisit(job.id, visit.id, { techId, date: day, start });
    close();
    openModal(MODAL.JOB, { jobId: job.id });
  }

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>Book a visit</h2>
      <p className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>
        {lead.name}
        {lead.job ? ` · ${lead.job}` : ""}
      </p>

      {/* Type — Job (priced on the visit) vs Estimate visit (scope, then quote) */}
      <div className="chips" style={{ marginBottom: 4 }}>
        <button className={`chip${purpose === "fix" ? " sel" : ""}`} onClick={() => setType("fix")}>
          Job
        </button>
        <button className={`chip${purpose === "look" ? " sel" : ""}`} onClick={() => setType("look")}>
          Estimate visit
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
        {purpose === "fix"
          ? "Diagnosed & priced on the visit."
          : "Scoped on site, then quoted — no job until they say yes."}
      </p>

      {/* What's the work */}
      <div className="field">
        <label>What&apos;s the work?</label>
        <input
          type="text"
          value={jobDesc}
          placeholder="e.g. Water heater making noise"
          onChange={(e) => setJobDesc(e.target.value)}
        />
      </div>

      {/* Day + Who goes */}
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10, display: "grid", marginTop: 4 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Day</label>
          <input type="date" value={day} min={TODAY_ISO} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Who goes</label>
          <select value={techId} onChange={(e) => setTechId(Number(e.target.value))}>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.sells ? " · sells" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Start + Hours */}
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10, display: "grid", marginTop: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Start</label>
          <input
            type="time"
            value={hToTime(start)}
            step={900}
            onChange={(e) => setStart(timeToH(e.target.value))}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hours</label>
          <input
            type="number"
            value={dur}
            min={0.5}
            step={0.5}
            onChange={(e) => setDur(Math.max(0.5, Number(e.target.value) || 0.5))}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" onClick={book}>
          Book the visit →
        </button>
      </div>
    </div>
  );
}
