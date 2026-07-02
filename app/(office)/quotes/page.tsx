"use client";

/**
 * Quotes page — pixel-faithful port of the prototype's vEstimates().
 * Uses SAMPLE_ESTIMATES / SAMPLE_LEADS from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype reference: elas-crm-prototype.html lines 2774–2819.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { estTotal, type SampleEstimate } from "@/lib/prototype-sample";
import { useEstimates, useLeads, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

// ---- helpers ----------------------------------------------------------------

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Mirrors prototype's isExpired(e) — expired when age > validDays */
function isExpired(e: SampleEstimate): boolean {
  if (e.status !== "sent") return false;
  const vd = (e as SampleEstimate & { validDays?: number }).validDays ?? 14;
  return (e.age ?? 0) > vd;
}

// ---- status pill map (prototype's stPill) -----------------------------------

type EstStatus = "draft" | "sent" | "accepted" | "declined" | "superseded";

const ST_PILL: Record<EstStatus, { cls: string; label: string }> = {
  draft:      { cls: "stamp ink",  label: "Draft" },
  sent:       { cls: "stamp info", label: "Sent" },
  accepted:   { cls: "stamp good", label: "Accepted" },
  declined:   { cls: "stamp bad",  label: "Declined" },
  superseded: { cls: "stamp ink",  label: "Superseded" },
};

// ---- follow-up cell (prototype's fu column logic) ---------------------------

function FollowUpCell({ e }: { e: SampleEstimate }) {
  const ext = e as SampleEstimate & { changeReq?: boolean; gbb?: boolean; viewsN?: number };

  if (ext.changeReq && e.status === "sent") {
    return (
      <span className="pill" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>
        change requested
      </span>
    );
  }
  if (ext.gbb && e.status === "sent" && (ext.viewsN ?? 0) >= 2) {
    return (
      <span className="pill" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>
        opened {ext.viewsN}× — comparing options
      </span>
    );
  }
  if (isExpired(e)) {
    return <span className="pill red">expired</span>;
  }
  if (e.status !== "sent") {
    return <span className="muted">—</span>;
  }
  if (e.fu.stage === 0) return <span className="muted">reminder 1 in 3d</span>;
  if (e.fu.stage === 1) return <span className="pill amber">reminder 1 sent</span>;
  return <span className="pill red">call them</span>;
}

// ============================================================================
// Main page
// ============================================================================

type QuoteFilter = "" | "sent" | "accepted" | "draft" | "changes";

export default function QuotesPage() {
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("");
  const [quoteQ, setQuoteQ] = useState("");
  const router = useRouter();
  const openModal = useOpenModal();
  const leads = useLeads();
  const estimates = useEstimates();

  const findLead = (leadId: number) => leads.find((l) => l.id === leadId);
  const all = estimates.filter((e) => !e.archived) as unknown as SampleEstimate[];

  const sent = all.filter((e) => e.status === "sent");
  const acc  = all.filter((e) => e.status === "accepted");
  const dr   = all.filter((e) => e.status === "draft");
  const cr   = all.filter(
    (e) => (e as SampleEstimate & { changeReq?: boolean }).changeReq && e.status === "sent"
  );

  // apply filter
  let shown: SampleEstimate[];
  if (quoteFilter === "changes") {
    shown = cr;
  } else if (quoteFilter) {
    shown = all.filter((e) => e.status === quoteFilter);
  } else {
    shown = all;
  }

  const total = shown.length;

  // apply search
  const q = quoteQ.trim().toLowerCase();
  if (q) {
    shown = shown.filter((e) => {
      const l = findLead(e.leadId);
      return [e.num, e.title, l?.name].some((x) =>
        (x ?? "").toLowerCase().includes(q)
      );
    });
  }

  function kpiSel(f: QuoteFilter): React.CSSProperties | undefined {
    return f === quoteFilter
      ? { borderColor: "var(--green-600)", background: "var(--green-50)" }
      : undefined;
  }

  const sentSum = sent.reduce((s, e) => s + estTotal(e), 0);
  const accSum  = acc.reduce((s, e) => s + estTotal(e), 0);

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1>Quotes</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => openModal(MODAL.QUOTE_SWEEP)}>
            Clean up
          </button>
          <button className="btn primary" onClick={() => router.push("/composer")}>
            + New quote
          </button>
        </div>
      </div>

      {/* sub-line */}
      <div className="sub">
        {quoteFilter ? (
          <>
            Showing{" "}
            <b>
              {quoteFilter === "sent"
                ? "awaiting response"
                : quoteFilter === "changes"
                ? "change requests"
                : quoteFilter}
            </b>{" "}
            —{" "}
            <span className="linklike" onClick={() => setQuoteFilter("")}>
              show all
            </span>
          </>
        ) : (
          "Tap a card to filter."
        )}
      </div>

      {/* KPI strip */}
      <div
        className="kpis"
        style={{ gridTemplateColumns: `repeat(${cr.length ? 4 : 3}, 1fr)` }}
      >
        {cr.length > 0 && (
          <div
            className="kpi"
            style={{
              borderColor: "#DDD3F8",
              background: "var(--purple-bg)",
              ...(quoteFilter === "changes" ? { outline: "2px solid var(--purple)" } : {}),
            }}
            onClick={() => setQuoteFilter("changes")}
          >
            <div className="lbl" style={{ color: "var(--purple)" }}>
              Changes requested
            </div>
            <div className="val" style={{ color: "var(--purple)" }}>
              {cr.length}
            </div>
            <div className="hint">customers waiting on you</div>
          </div>
        )}

        <div className="kpi" style={kpiSel("sent")} onClick={() => setQuoteFilter("sent")}>
          <div className="lbl">Awaiting response</div>
          <div className="val">{fmt$(sentSum)}</div>
          <div className="hint">{sent.length} out the door</div>
        </div>

        <div className="kpi" style={kpiSel("accepted")} onClick={() => setQuoteFilter("accepted")}>
          <div className="lbl">Accepted this month</div>
          <div className="val">{fmt$(accSum)}</div>
          <div className="hint">{acc.length} wins</div>
        </div>

        <div className="kpi" style={kpiSel("draft")} onClick={() => setQuoteFilter("draft")}>
          <div className="lbl">Drafts</div>
          <div className="val">{dr.length}</div>
          <div className="hint">not sent yet — tap to see them</div>
        </div>
      </div>

      {/* search toolbar */}
      <div className="toolbar">
        <input
          type="text"
          id="qQ"
          placeholder="Search #, title, customer…"
          value={quoteQ}
          onChange={(e) => setQuoteQ(e.target.value)}
        />
        <span className="muted" style={{ marginLeft: "auto" }}>
          {shown.length} of {total}
        </span>
      </div>

      {/* table */}
      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Follow-up</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {shown.length > 0 ? (
              shown.map((e) => {
                const l = findLead(e.leadId);
                const st = ST_PILL[e.status as EstStatus] ?? { cls: "stamp ink", label: e.status };
                return (
                  <tr
                    key={e.id}
                    className="clickable"
                    onClick={() => openModal(MODAL.EST, { estId: e.id })}
                  >
                    <td className="muted">{e.num}</td>
                    <td>
                      <b>{e.title}</b>
                    </td>
                    <td>{l ? l.name : "—"}</td>
                    <td>
                      <span className={st.cls}>{st.label}</span>
                    </td>
                    <td>
                      <FollowUpCell e={e} />
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {fmt$(estTotal(e))}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6}>
                  <div className="empty-att">
                    Nothing matches —{" "}
                    <span
                      className="linklike"
                      onClick={() => {
                        setQuoteQ("");
                        setQuoteFilter("");
                      }}
                    >
                      show all
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
