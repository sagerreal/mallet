"use client";

/**
 * Pipeline page — pixel-faithful port of the prototype's vPipeline().
 * Uses SAMPLE_LEADS / SAMPLE_ESTIMATES from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype reference: elas-crm-prototype.html lines 2457–2518.
 *
 * STUBS (visual / no-op):
 *   - openLead(id)          — opens lead detail overlay
 *   - openQuickAdd()        — opens new customer modal
 *   - openSweep()           — opens clean-up overlay
 *   - startComposer(id)     — opens the composer for a lead
 *   - dragLead / dropLead   — drag-and-drop card between stages
 *   - dropTrash             — trash-zone drop (mark lost / archive)
 *   - toggleFold(col)       — fold/unfold healthy section in busy cols
 *   - boardSearch(val)      — board-level search (>20 leads)
 */

import { useState } from "react";
import {
  SAMPLE_LEADS,
  SAMPLE_ESTIMATES,
  type SampleLead,
  type SampleEstimate,
} from "@/lib/prototype-sample";

// ---- helpers ported from prototype -----------------------------------------

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const PIPELINE_STAGES = ["New customer", "Contacted", "Quote Sent", "Won"];
const ACTIVE_STAGES = ["New customer", "Contacted", "Quote Sent"];

/** mirrors prototype stageNorm() — normal days per stage before flagging */
const STAGE_NORMS: Record<string, number> = {
  "New customer": 2,
  Contacted: 4,
  "Quote Sent": 7,
};

function stageNorm(s: string): number {
  return STAGE_NORMS[s] ?? (s === "Won" || s === "Lost" ? 999 : 5);
}

function liveLeads(): SampleLead[] {
  return SAMPLE_LEADS.filter(
    (l) => !(l as SampleLead & { archived?: boolean }).archived
  );
}

function liveEsts(): SampleEstimate[] {
  return SAMPLE_ESTIMATES;
}

function estTotal(e: SampleEstimate): number {
  const p: { disc?: number; dep?: number; tax?: number } = e.pricing ?? {};
  const sub = e.lines
    .filter((l) => !l.opt)
    .reduce((s, l) => s + l.q * l.r, 0);
  const disc = sub * ((p.disc ?? 0) / 100);
  const taxed = (sub - disc) * ((p.tax ?? 0) / 100);
  return sub - disc + taxed;
}

function leadVal(l: SampleLead): number {
  const e = liveEsts().find(
    (e) => e.leadId === l.id && e.status !== "draft"
  );
  return e ? estTotal(e) : (l.value ?? 0);
}

function pipeLeads(): SampleLead[] {
  // board excludes book:true (direct-booked) records
  return liveLeads().filter((l) => !l.book);
}

function staleLeads(): SampleLead[] {
  return liveLeads().filter(
    (l) => ACTIVE_STAGES.includes(l.stage) && l.age >= 10
  );
}

/** Scoped visit on file but no quote yet — triggers "Build quote" nudge */
function leadScopedNeedsQuote(l: SampleLead): boolean {
  if (!l || l.stage === "Won" || l.stage === "Lost") return false;
  const v = (l.evisits ?? []).find(
    (x) => (x as { scoped?: boolean }).scoped
  );
  return !!(v && !liveEsts().some((e) => e.leadId === l.id));
}

function SrcPill({ source }: { source: string }) {
  return <span className="pill src">{source}</span>;
}

// ---- stubs ------------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ---- Kanban card ------------------------------------------------------------

function KanbanCard({
  l,
  compact,
}: {
  l: SampleLead;
  compact: boolean;
}) {
  const scoped = leadScopedNeedsQuote(l);
  const flagged = l.age > stageNorm(l.stage);
  const val = leadVal(l);
  const accentStyle: React.CSSProperties = scoped
    ? { borderLeft: "3px solid var(--amber)" }
    : {};

  if (compact) {
    return (
      <div
        className={`kcard mini${flagged ? " flag" : ""}`}
        style={accentStyle}
        onClick={() => stub("openLead", l.id)}
      >
        <span className="nm-mini">{l.name}</span>
        <span className="mini-meta">
          {scoped && (
            <span
              className="pill amber"
              style={{ fontSize: "9.5px", padding: "1px 5px" }}
            >
              quote it
            </span>
          )}{" "}
          {val ? fmt$(val) + " · " : ""}
          {l.age}d
        </span>
      </div>
    );
  }

  return (
    <div
      className={`kcard${flagged ? " flag" : ""}`}
      style={accentStyle}
      onClick={() => stub("openLead", l.id)}
    >
      <div className="nm">
        <span>
          {l.unread && (
            <span style={{ color: "var(--blue)" }}> </span>
          )}
          {l.name}
        </span>
        <span>{val ? fmt$(val) : ""}</span>
      </div>
      <div className="muted" style={{ marginTop: 3 }}>
        {l.job ?? ""}
      </div>
      {scoped ? (
        <div
          style={{
            marginTop: 7,
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          <span className="pill amber">● Scoped — needs quote</span>
          <button
            className="btn primary sm"
            onClick={(e) => {
              e.stopPropagation();
              stub("startComposer", l.id);
            }}
          >
            Build quote
          </button>
        </div>
      ) : (
        <div className="meta">
          <SrcPill source={l.source} />
          <span className="days">{l.age}d</span>
        </div>
      )}
    </div>
  );
}

// ---- Column -----------------------------------------------------------------

function PipelineColumn({ stage }: { stage: string }) {
  const [expanded, setExpanded] = useState(false);

  let leads = pipeLeads().filter((l) => l.stage === stage);
  if (stage === "Won") leads = leads.filter((l) => l.age <= 30);

  // flagged leads (age > norm) float to top, within each group oldest first
  leads = [...leads].sort(
    (a, b) =>
      b.age - stageNorm(stage) - (a.age - stageNorm(stage))
  );

  const sum = leads.reduce((s, l) => s + leadVal(l), 0);
  const compact = leads.length > 7;
  const fold = leads.length > 20;
  const flagged = leads.filter((l) => l.age > stageNorm(stage));
  const healthy = leads.filter((l) => l.age <= stageNorm(stage));

  const colHead = stage === "Won" ? "Won · 30d" : stage;

  return (
    <div
      className="col"
      onDragOver={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.add("dragover");
      }}
      onDragLeave={(e) =>
        (e.currentTarget as HTMLElement).classList.remove("dragover")
      }
      onDrop={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.remove("dragover");
        stub("dropLead", stage);
      }}
    >
      <div className="col-head">
        <span>
          {colHead}&nbsp;
          <span className="muted">{leads.length}</span>
        </span>
        <span className="sum">{sum ? fmt$(sum) : ""}</span>
      </div>

      {fold ? (
        <>
          {flagged.map((l) => (
            <KanbanCard key={l.id} l={l} compact={compact} />
          ))}
          <div
            className="foldbar"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾" : "▸"} {healthy.length} on track —{" "}
            {expanded ? "hide" : "show"}
          </div>
          {expanded &&
            healthy.map((l) => (
              <KanbanCard key={l.id} l={l} compact={compact} />
            ))}
        </>
      ) : leads.length > 0 ? (
        leads.map((l) => (
          <KanbanCard key={l.id} l={l} compact={compact} />
        ))
      ) : (
        <div className="empty-att" style={{ padding: "24px 0" }}>
          —
        </div>
      )}
    </div>
  );
}

// ---- Main page --------------------------------------------------------------

export default function PipelinePage() {
  const [boardQ, setBoardQ] = useState("");

  const live = pipeLeads();
  const lost = SAMPLE_LEADS.filter((l) => l.stage === "Lost");
  const activeCount = live.filter(
    (l) => l.stage !== "Lost" && l.stage !== "Won"
  ).length;
  const stale = staleLeads();

  // Prototype: search bar only appears once > 20 active leads on the board
  const showSearch = activeCount > 20;
  void boardQ; // wire-up stub — search is visual at this volume

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1>Pipeline</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => stub("openSweep")}>
            Clean up
            {stale.length > 0 && (
              <span className="pill amber" style={{ marginLeft: 2 }}>
                {stale.length}
              </span>
            )}
          </button>
          <button
            className="btn primary"
            onClick={() => stub("openQuickAdd")}
          >
            + New customer
          </button>
        </div>
      </div>

      <div className="sub">
        Lead → quote → won — drag a card to move it.
      </div>

      {/* Optional search bar — only at volume > 20 active leads */}
      {showSearch && (
        <div className="board-tools">
          <input
            placeholder="Jump to a name or job…"
            value={boardQ}
            onChange={(e) => setBoardQ(e.target.value)}
          />
        </div>
      )}

      {/* Board */}
      <div className="board">
        {PIPELINE_STAGES.map((stage) => (
          <PipelineColumn key={stage} stage={stage} />
        ))}
      </div>

      {/* Lost bar */}
      <div
        className="lostbar"
        onClick={() =>
          stub(
            "toast",
            "Lost deals stay out of the way — but every loss reason feeds the source report."
          )
        }
      >
        ✕ Lost ({lost.length}) —{" "}
        {lost
          .slice(0, 6)
          .map((l) => l.name + " · " + (l.lossReason ?? ""))
          .join(", ")}
        {lost.length > 6 ? " …" : ""}
      </div>

      {/* Trash zone — fixed, appears only when body.dragging (CSS shows it) */}
      <div
        id="trashzone"
        onDragOver={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add("hot");
        }}
        onDragLeave={(e) =>
          (e.currentTarget as HTMLElement).classList.remove("hot")
        }
        onDrop={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove("hot");
          stub("dropTrash");
        }}
      >
        Drop to clean up — mark Lost (with reason) or Archive
      </div>
    </div>
  );
}
