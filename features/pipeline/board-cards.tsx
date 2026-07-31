/**
 * features/pipeline/board-cards.tsx
 * The board's cards, all speaking the rail language: dot · name · $ · job ·
 * ≤6-word mono stamp. Amber means needs-you (halo) or customer-touching-now
 * (breath). Cards that need a word carry their drafted text + one amber Send
 * on the face — committed through the shared OK-send primitive with a 30s undo.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { fmt$ } from "@/lib/format";
import { estTotal, gbbTierLine } from "@/lib/estimates";
import { firstName, type OkItem } from "@/features/home/derive";
import { clockNow, commitOkSend, dispatchOkSend } from "@/features/home/send";
import { userMessage } from "@/lib/trpc/error-map";
import { draftFor } from "@/features/home/drafts";
import { okItemFor } from "@/features/counter/matcher";
import { chaseDraftFor } from "@/features/counter/runs";
import { draftNudge } from "./pipeline-lanes";
import { dotSize, type RailRow, type WonRow } from "@/features/quotes/derive";
import type { Snap } from "@/features/counter/types";
import type { GettingRow, IntakeRow } from "./working";

const UNDO_MS = 30_000;

function Dot({ size, live, hollow, halo }: { size: number; live?: boolean; hollow?: boolean; halo?: boolean }) {
  return (
    <span
      className={`qdot${live ? " live" : ""}${hollow ? " hollow" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {halo && <span className="qring halo" />}
    </span>
  );
}

// ---- the on-card send: ghost draft → one amber Send → ledger line + undo ------

function SendBlock({
  item,
  fallback,
  initial,
}: {
  /** OK-queue item to commit through (fu bump etc.), or null for a plain text. */
  item: OkItem | null;
  /** Plain-text fallback target when there's no queue item. */
  fallback: { leadId: string; first: string; age: number };
  initial: string;
}) {
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const undismissAttention = useAppStore((s) => s.undismissAttention);
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<{ when: string; undo: () => void; expiresAt: number } | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sent) return;
    timer.current = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [sent]);

  const secs = sent ? Math.max(0, Math.ceil((sent.expiresAt - Date.now()) / 1000)) : 0;

  function send(e: React.MouseEvent) {
    e.stopPropagation();
    const body = text.trim();
    if (item) {
      const undoSend = commitOkSend(item, body);
      dismissAttention(item.key);
      const revert = () => {
        undoSend();
        undismissAttention(item.key);
      };
      setSent({ when: clockNow(), undo: revert, expiresAt: Date.now() + UNDO_MS });
      // REAL dispatch (v1.messaging.send). On failure: revert the local commit, bring
      // the card back, and name the reason — never leave a "✓ sent" that sent nothing.
      dispatchOkSend(item.lead.id, body).catch((err: unknown) => {
        revert();
        setSent(null);
        setSendErr(userMessage(err, "Couldn't send — check your connection and try again."));
      });
      return;
    }
    const s = useAppStore.getState();
    const note = s.addLeadNote(fallback.leadId, { type: "text", from: "us", when: "Just now", t: body });
    s.updateLead(fallback.leadId, { age: 0 });
    const prevAge = fallback.age;
    const revert = () => {
      const s2 = useAppStore.getState();
      s2.removeLeadNote(fallback.leadId, note.id ?? "");
      s2.updateLead(fallback.leadId, { age: prevAge });
    };
    setSent({ when: clockNow(), undo: revert, expiresAt: Date.now() + UNDO_MS });
    dispatchOkSend(fallback.leadId, body).catch((err: unknown) => {
      revert();
      setSent(null);
      setSendErr(userMessage(err, "Couldn't send — check your connection and try again."));
    });
  }

  if (sent) {
    return (
      <div className="cardsent fig" onClick={(e) => e.stopPropagation()}>
        {sent.when} ✓ sent
        {secs > 0 && (
          <>
            {" · "}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                sent.undo();
                setSent(null);
              }}
            >
              Undo · {secs}s
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <textarea
          className="cardghost-edit"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`Message to ${fallback.first}`}
        />
      ) : (
        <div className="cardghost">{text}</div>
      )}
      {sendErr && (
        <div className="cstamp" style={{ color: "var(--red-700, #b91c1c)" }}>{sendErr}</div>
      )}
      <div className="cardacts">
        <button className="btn sm approve" onClick={send}>
          Send
        </button>
        {/* "Edit text" — edits the CHASE MESSAGE only. (It read "Change" before, which
            sat ambiguously next to a change-requested quote — revising the quote itself
            is the card's "Edit & resend" action.) */}
        <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit text"}
        </button>
      </div>
    </div>
  );
}

// ---- column 1: working itself ---------------------------------------------------

export function IntakeCard({ row, snap }: { row: IntakeRow; snap: Snap }) {
  const openModal = useOpenModal();
  const item = okItemFor(row.lead, snap);
  return (
    <div className="kcard" onClick={() => openModal(MODAL.LEAD, { leadId: row.lead.id })}>
      <div className="crow">
        <Dot size={11} halo={row.stalled} />
        <button
          type="button"
          className="cname rowopen"
          aria-label={`Open ${row.lead.name}`}
          onClick={(e) => { e.stopPropagation(); openModal(MODAL.LEAD, { leadId: row.lead.id }); }}
        >
          {row.lead.name}
        </button>
      </div>
      <div className="cjob">{row.lead.job}</div>
      <div className="cstamp fig">{row.stamp}</div>
      {row.stalled && (
        <SendBlock
          item={item}
          fallback={{ leadId: row.lead.id, first: firstName(row.lead.name), age: row.lead.age }}
          initial={item ? draftFor(item) : draftNudge(row.lead)}
        />
      )}
    </div>
  );
}

// ---- column 2: getting the number -------------------------------------------------

export function GettingCard({ row }: { row: GettingRow }) {
  const openModal = useOpenModal();
  const router = useRouter();

  function openIt() {
    if (row.est) openModal(MODAL.EST, { estId: row.est.id });
    else openModal(MODAL.LEAD, { leadId: row.lead.id });
  }
  function verbAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (row.kind === "scoped") router.push(`/composer?lead=${row.lead.id}`);
    else if (row.est) openModal(MODAL.EST, { estId: row.est.id });
  }

  return (
    <div className="kcard" onClick={openIt}>
      <div className="crow">
        <Dot size={10} hollow={row.kind === "shop"} halo={row.kind === "scoped"} />
        <button
          type="button"
          className="cname rowopen"
          aria-label={`Open ${row.lead.name}`}
          onClick={(e) => { e.stopPropagation(); openIt(); }}
        >
          {row.lead.name}
        </button>
        {row.est && <span className="camt fig" style={{ opacity: 0.6 }}>{fmt$(estTotal(row.est))}</span>}
      </div>
      <div className="cjob">{row.lead.job}</div>
      <div className="cstamp fig">
        {row.stamp}
        {row.verb && (
          <>
            {" · "}
            <button type="button" className="linklike" onClick={verbAction}>
              {row.verb}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- column 3: out (telemetry) ------------------------------------------------------

export function OutCard({ row, snap }: { row: RailRow; snap: Snap }) {
  const openModal = useOpenModal();
  const router = useRouter();
  const cold = row.quietDays >= 2;
  const item: OkItem | null = row.lead
    ? {
        key: `okq-${row.est.id}`,
        kind: "quote-viewed",
        lead: row.lead,
        estimate: row.est,
        value: row.total,
        situation: row.stamp,
        editLabel: "Change",
      }
    : null;

  return (
    <div className="kcard" style={{ opacity: row.cool }} onClick={() => openModal(MODAL.EST, { estId: row.est.id })}>
      <div className="crow">
        <Dot size={dotSize(row.total) - 3} live={row.live} />
        <button
          type="button"
          className="cname rowopen"
          aria-label={`Open quote for ${row.lead?.name ?? "customer"}`}
          onClick={(e) => { e.stopPropagation(); openModal(MODAL.EST, { estId: row.est.id }); }}
        >
          {row.lead?.name ?? "—"}
        </button>
        <span className="camt fig">{fmt$(row.total)}</span>
      </div>
      <div className="cjob">{row.est.title}</div>
      <div className="cstamp fig">{row.stamp}</div>
      {gbbTierLine(row.est) && <div className="cstamp fig">{gbbTierLine(row.est)}</div>}
      {row.est.changeRequestedAt && (
        <>
          <div className="cstamp fig" style={{ color: "var(--amber, #b45309)" }}>
            change requested
          </div>
          <div className="cardacts" onClick={(e) => e.stopPropagation()}>
            <button className="btn sm approve" onClick={() => router.push(`/composer?revise=${row.est.id}`)}>
              Edit &amp; resend
            </button>
          </div>
        </>
      )}
      {cold && item && (
        <SendBlock
          item={item}
          fallback={{ leadId: item.lead.id, first: firstName(item.lead.name), age: item.lead.age }}
          initial={chaseDraftFor(item, snap).draft}
        />
      )}
    </div>
  );
}

// ---- column 4: won --------------------------------------------------------------------

export function WonCard({ row }: { row: WonRow }) {
  const openModal = useOpenModal();
  const router = useRouter();
  return (
    <div className="kcard" onClick={() => openModal(MODAL.EST, { estId: row.est.id })}>
      <div className="crow">
        <Dot size={dotSize(row.total) - 3} halo={row.unscheduled} />
        <button
          type="button"
          className="cname rowopen"
          aria-label={`Open quote for ${row.lead?.name ?? "customer"}`}
          onClick={(e) => { e.stopPropagation(); openModal(MODAL.EST, { estId: row.est.id }); }}
        >
          {row.lead?.name ?? "—"}
        </button>
        <span className="camt fig">{fmt$(row.total)}</span>
      </div>
      <div className="cjob">{row.est.title}</div>
      <div className="cstamp fig">{row.stamp}</div>
      {gbbTierLine(row.est) && <div className="cstamp fig">{gbbTierLine(row.est)}</div>}
      {row.unscheduled && row.job && (
        <div className="cardacts" onClick={(e) => e.stopPropagation()}>
          <button className="btn sm approve" onClick={() => router.push("/jobs?tab=schedule")}>
            Pick the day
          </button>
        </div>
      )}
    </div>
  );
}
