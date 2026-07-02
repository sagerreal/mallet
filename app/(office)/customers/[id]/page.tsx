"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SAMPLE_LEADS,
  SAMPLE_ESTIMATES,
  SAMPLE_TASKS,
  SAMPLE_JOBS,
  SAMPLE_BRAND,
  TODAY_ISO,
  findLead,
  findEst,
  findCompany,
  calcQuote,
  estTotal,
  STAGE_PILL_CLS,
  leadInitials,
  type SampleLead,
  type SampleEstimate,
  type SampleEstimateLine,
} from "@/lib/prototype-sample";

// ---- helpers ----

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StagePill({ stage }: { stage: string }) {
  const cls = STAGE_PILL_CLS[stage] ?? "ink";
  return <span className={`stamp ${cls}`}>{stage}</span>;
}

function SrcPill({ src }: { src: string }) {
  return <span className="pill src">{src}</span>;
}

// Note chip color (mirrors noteChipCls)
function noteChipCls(k: string): string {
  if (k === "completion") return "green";
  if (k === "change") return "amber";
  if (["call", "text", "visit", "ai", "field"].includes(k)) return "blue";
  return "gray";
}

interface NoteEntry {
  k: string;
  label: string;
  who: string;
  when: string;
  text: string;
}

function buildTimeline(lead: SampleLead): NoteEntry[] {
  const rank: Record<string, number> = {
    request: 0, internal: 1, prep: 1, call: 2, text: 2, visit: 2, ai: 2, scope: 3, change: 3, field: 3, completion: 4,
  };
  const E: NoteEntry[] = [];

  // activity log
  for (const a of lead.acts ?? []) {
    const firstName = lead.name.split(" ")[0] ?? lead.name;
    if (a.type === "call") {
      E.push({
        k: "call",
        label: "Call",
        who: a.dir === "in" ? firstName : "You",
        when: a.when ?? "",
        text: `${a.dir === "in" ? "Incoming" : "Outgoing"} call — ${a.outcome ?? ""}${a.dur ? ` · ${a.dur}` : ""}${a.notes ? ` · "${a.notes}"` : ""}`,
      });
    } else if (a.type === "text") {
      E.push({
        k: "text",
        label: "Text",
        who: a.from === "them" ? firstName : (a.from === "auto" ? "Auto-text" : "You"),
        when: a.when ?? "",
        text: a.t ?? "",
      });
    }
  }

  // job notes from matching jobs
  for (const j of SAMPLE_JOBS.filter((j) => j.leadId === lead.id && !j.archived)) {
    for (const n of (j as unknown as { jobNotes?: { by: string; who: string; t: string; when: string }[] }).jobNotes ?? []) {
      E.push({ k: n.by === "tech" ? "field" : "prep", label: n.by === "tech" ? "Field" : "Office", who: n.who, when: n.when, text: n.t });
    }
  }

  E.sort((a, b) => ((rank[a.k] ?? 2) - (rank[b.k] ?? 2)));
  return E;
}

// ---- Note Timeline ----
function NoteTimeline({ lead }: { lead: SampleLead }) {
  const entries = buildTimeline(lead);
  return (
    <div className="card" style={{ marginBottom: "10px" }}>
      <h3>Notes</h3>
      <div className="nfeed">
        {entries.length === 0 ? (
          <div className="muted" style={{ fontSize: "13px", padding: "4px 0" }}>
            No notes yet — add the first below.
          </div>
        ) : (
          entries.map((n, i) => (
            <div className="nrow" key={i}>
              <div className="nmeta">
                <span className={`pill ${noteChipCls(n.k)}`}>{n.label}</span>
                <span className="nwho">
                  {n.who ? `${n.who} · ` : ""}
                  {n.when}
                </span>
              </div>
              <div className="ntext">{n.text}</div>
            </div>
          ))
        )}
      </div>
      {/* STUB: addLeadNote() not wired */}
      <div className="cfrow" style={{ marginTop: "10px" }}>
        <input
          placeholder="gate code, what they want, what happened…"
          style={{ flex: 2 }}
          disabled
        />
        <button className="btn sm primary" disabled style={{ opacity: 0.5 }}>
          Add note
        </button>
      </div>
    </div>
  );
}

// ---- Next Step block ----
function NextStepBlock({ lead }: { lead: SampleLead }) {
  const openTasks = SAMPLE_TASKS.filter((t) => !t.done && t.leadId === lead.id);
  const first = lead.name.split(" ")[0];
  const today = TODAY_ISO;
  const overdue = (due: string) => due < today;

  const suggest =
    openTasks.length === 0 ? (
      lead.stage === "New customer" ? (
        <div className="stage-row" style={{ border: "none", padding: "3px 0", alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: "13px" }}>
            📞 First call to <b>{first}</b>
          </span>
          {/* STUB: openCallSheet() not wired */}
          <button className="btn sm primary" disabled style={{ opacity: 0.5 }}>
            Call now
          </button>
        </div>
      ) : (
        <div className="stage-row" style={{ border: "none", padding: "3px 0", alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: "13px" }}>
            Follow up with <b>{first}</b>
          </span>
          {/* STUB: openCallSheet() not wired */}
          <button className="btn sm" disabled style={{ opacity: 0.5 }}>
            Call
          </button>
        </div>
      )
    ) : null;

  return (
    <div>
      <div
        className="muted"
        style={{ fontSize: "10.5px", fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", marginBottom: "7px" }}
      >
        Next step
      </div>
      {suggest}
      {openTasks.map((t) => (
        <div key={t.id} className="stage-row" style={{ border: "none", padding: "3px 0", alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: "13px" }}>
            ☐ {t.t} —{" "}
            {overdue(t.due) ? (
              <span style={{ fontWeight: 700, color: "var(--red)" }}>{t.due}</span>
            ) : t.due === today ? (
              <span style={{ fontWeight: 700, color: "var(--amber)" }}>Today</span>
            ) : (
              <span className="muted">{t.due}</span>
            )}
          </span>
          {/* STUB: taskDoneLead() not wired */}
          <span className="linklike" style={{ opacity: 0.5 }}>
            done
          </span>
        </div>
      ))}
      <div style={{ marginTop: "6px" }}>
        {/* STUB: add task UI not wired */}
        <span className="linklike" style={{ opacity: 0.5 }}>
          + Add a task
        </span>
      </div>
    </div>
  );
}

// ---- Quotes section ----
const EST_STATUS_PILL: Record<string, string> = {
  draft: "ink",
  sent: "info",
  accepted: "good",
  declined: "bad",
  superseded: "ink",
};

function QuotesSection({ lead }: { lead: SampleLead }) {
  const ests = SAMPLE_ESTIMATES.filter((e) => e.leadId === lead.id);
  if (ests.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: "10px" }}>
      <h3>{ests.length > 1 ? `${ests.length} quotes` : "Quote"}</h3>
      {ests.map((q) => (
        <div
          key={q.id}
          className="att-item"
          style={{ cursor: "pointer" }}
          // STUB: openEst() not wired — clicking is visual-only
        >
          <div className="att-ico" style={{ background: "var(--green-50)", color: "var(--green-900)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" style={{ width: "16px", height: "16px" }}>
              <path d="M7 3h7l4 4v14H7z" />
              <path d="M14 3v4h4" />
              <path d="M9.5 12.5h5M9.5 16h5" />
            </svg>
          </div>
          <div className="att-body">
            <b style={{ fontWeight: 600 }}>
              {q.num} — {q.title}
            </b>
            <div className="why">Tap to open the lines, options &amp; pricing</div>
          </div>
          <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmt$(estTotal(q))}</span>
          <span className={`stamp ${EST_STATUS_PILL[q.status] ?? "ink"}`}>{q.status}</span>
          <span style={{ opacity: 0.4, fontSize: "16px" }}>→</span>
        </div>
      ))}
    </div>
  );
}

// ---- GBB quote builder (renderCustGbb) ----
interface GbbQuoteProps {
  est: SampleEstimate & { gbb: GbbData };
  lead: SampleLead;
}

interface GbbOption {
  k: string;
  name: string;
  title: string;
  lines: (SampleEstimateLine & { tune?: boolean })[];
}

interface GbbData {
  rec: string;
  opts: GbbOption[];
}

function gbbTierTotal(opt: GbbOption): number {
  return opt.lines.reduce((s, x) => s + (x.q ?? 1) * (x.r ?? 0), 0);
}

function GbbQuoteBuilder({ est, lead }: GbbQuoteProps) {
  const g = est.gbb;
  const b = SAMPLE_BRAND;
  const [sel, setSel] = useState<string>(g.rec);
  const [offs, setOffs] = useState<Record<string, boolean>>({});
  const [adds, setAdds] = useState<Record<string, boolean>>({});

  const order = ["good", "better", "best"];
  const idx = order.indexOf(sel);
  const selOpt = g.opts.find((o) => o.k === sel);
  const above = idx < 2 ? g.opts.find((o) => o.k === order[idx + 1]) : null;

  if (!selOpt) return null;

  const selKeys = new Set(selOpt.lines.map((x) => x.d));
  const addable = above ? above.lines.filter((x) => !selKeys.has(x.d) && x.tune) : [];

  let total = selOpt.lines.reduce((s, x) => s + (offs[x.d] ? 0 : (x.q ?? 1) * (x.r ?? 0)), 0);
  for (const x of addable) {
    if (adds[x.d]) total += (x.q ?? 1) * (x.r ?? 0);
  }

  function selectTier(k: string) {
    setSel(k);
    setOffs({});
    setAdds({});
  }

  function toggleOff(d: string, checked: boolean) {
    setOffs((prev) => ({ ...prev, [d]: !checked }));
  }

  function toggleAdd(d: string, checked: boolean) {
    setAdds((prev) => ({ ...prev, [d]: checked }));
  }

  return (
    <div>
      {/* Brand header */}
      <div className="custhead" style={{ background: b.color }}>
        <div className="custlogo" style={{ color: b.color }}>{b.initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: "16px" }}>{b.name}</div>
          <div style={{ fontSize: "11.5px", opacity: 0.8 }}>{b.tagline}</div>
        </div>
      </div>

      <div className="custbody">
        <p style={{ fontSize: "13.5px", lineHeight: 1.55, marginBottom: "6px" }}>
          Hi {lead.name.split(" ")[0]} — here are <b>three ways to do this</b>. Pick one, tweak
          it, approve right here.
        </p>
        <p className="muted" style={{ marginBottom: "10px" }}>
          Quote {est.num} · price good for {est.validDays ?? 14} days
        </p>

        {/* Tier buttons */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          {g.opts.map((o) => {
            const isSel = o.k === sel;
            const isRec = g.rec === o.k;
            return (
              <div
                key={o.k}
                onClick={() => selectTier(o.k)}
                style={{
                  flex: 1,
                  minWidth: "110px",
                  cursor: "pointer",
                  border: `2px solid ${isSel ? b.color : "var(--line)"}`,
                  borderRadius: "12px",
                  padding: "11px",
                  textAlign: "center",
                  background: isSel ? "var(--green-50)" : undefined,
                }}
              >
                {isRec && (
                  <div
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 800,
                      letterSpacing: ".6px",
                      color: b.color,
                      textTransform: "uppercase",
                    }}
                  >
                    most popular
                  </div>
                )}
                <div style={{ fontWeight: 800, fontSize: "14px" }}>{o.name}</div>
                <div className="muted" style={{ fontSize: "11px" }}>{o.title}</div>
                <div style={{ fontWeight: 900, fontSize: "16.5px", marginTop: "3px" }}>
                  {fmt$(gbbTierTotal(o))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected tier lines */}
        {selOpt.lines.map((x) =>
          x.tune ? (
            <label key={x.d} className="addonrow">
              <input
                type="checkbox"
                checked={!offs[x.d]}
                onChange={(e) => toggleOff(x.d, e.target.checked)}
              />
              <span style={{ flex: 1 }}>{x.d}</span>
              <b>{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
            </label>
          ) : (
            <div key={x.d} className="custline">
              <span>
                {x.d}
                {(x.q ?? 1) !== 1 ? ` × ${x.q}` : ""}
              </span>
              <b>{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
            </div>
          )
        )}

        {/* Addable lines from tier above */}
        {addable.map((x) => (
          <label
            key={x.d}
            className="addonrow"
            style={{ borderColor: "var(--manila-line)", background: "#FFFBEF" }}
          >
            <input
              type="checkbox"
              checked={!!adds[x.d]}
              onChange={(e) => toggleAdd(x.d, e.target.checked)}
            />
            <span style={{ flex: 1 }}>
              <b>Add from {above?.name}:</b> {x.d}
            </span>
            <b>+{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
          </label>
        ))}

        {/* Total */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "4px",
            padding: "14px 0 4px",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: "19px" }}>Total {fmt$(total)}</div>
          <div className="muted" style={{ fontSize: "11.5px" }}>
            {selOpt.name} — {selOpt.title}
            {(Object.values(offs).some(Boolean) || Object.values(adds).some(Boolean))
              ? " · tuned by you"
              : ""}
          </div>
        </div>

        {/* Approve button — STUB */}
        <button
          className="btn primary"
          style={{ width: "100%", padding: "13px", fontSize: "14.5px", marginTop: "6px" }}
          disabled
          // STUB: approveGbbSel() not wired
        >
          ✓ Approve {selOpt.name} — {fmt$(total)}
        </button>

        <div style={{ textAlign: "center", marginTop: "8px" }}>
          {/* STUB: Request a change and decline flows not wired */}
          <span className="linklike" style={{ opacity: 0.5 }}>
            Request a change
          </span>
        </div>
        <div style={{ textAlign: "center", marginTop: "10px" }}>
          <span className="linklike" style={{ opacity: 0.5 }}>
            None of these quite work
          </span>
        </div>

        <p className="muted" style={{ fontSize: "10.5px", textAlign: "center", marginTop: "12px" }}>
          Powered by Mallet — licensed &amp; insured
        </p>
      </div>
    </div>
  );
}

// ---- Standard customer-facing quote view (renderCust for non-GBB) ----
function CustomerQuoteView({ est, lead }: { est: SampleEstimate; lead: SampleLead }) {
  const b = SAMPLE_BRAND;
  const [selOpts, setSelOpts] = useState<Record<number, boolean>>({});
  const m = calcQuote(est.lines, est.pricing);
  const p: { disc?: number; dep?: number; tax?: number } = est.pricing ?? {};
  const first = lead.name.split(" ")[0];

  const optLines = est.lines.map((x, i) => ({ ...x, _i: i })).filter((x) => x.opt);
  const addedOptTotal = optLines
    .filter((x) => selOpts[x._i])
    .reduce((s, x) => s + x.q * x.r, 0);
  const displayTotal = m.total + addedOptTotal;

  return (
    <div>
      <div className="custhead" style={{ background: b.color }}>
        <div className="custlogo" style={{ color: b.color }}>{b.initials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: "16px" }}>{b.name}</div>
          <div style={{ fontSize: "11.5px", opacity: 0.8 }}>{b.tagline}</div>
        </div>
      </div>
      <div className="custbody">
        <p style={{ fontSize: "13.5px", lineHeight: 1.55, marginBottom: "6px" }}>
          Hi {first} — thanks for having us out. Here&apos;s your quote for <b>{est.title}</b>.
        </p>
        <p className="muted" style={{ marginBottom: "8px" }}>
          Quote {est.num} · price good for {est.validDays ?? 14} days
        </p>

        {/* Required lines */}
        {est.lines
          .filter((x) => !x.opt)
          .map((x, i) => (
            <div key={i}>
              <div className="custline">
                <span>
                  {x.d}
                  {x.q !== 1 ? ` × ${x.q}` : ""}
                </span>
                <b>{fmt$(x.q * x.r)}</b>
              </div>
              {x.photo && (
                <div className="photo-thumb">tech photo — current condition</div>
              )}
            </div>
          ))}

        {/* Optional add-ons */}
        {optLines.map((x) => (
          <label key={x._i} className="addonrow">
            <input
              type="checkbox"
              checked={!!selOpts[x._i]}
              onChange={(e) =>
                setSelOpts((prev) => ({ ...prev, [x._i]: e.target.checked }))
              }
            />
            <span style={{ flex: 1 }}>
              <b>Add:</b> {x.d}
            </span>
            <b>+{fmt$(x.q * x.r)}</b>
          </label>
        ))}

        {/* Totals */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "4px",
            padding: "14px 0 4px",
          }}
        >
          {(p.disc || p.tax) && (
            <div className="muted" style={{ fontSize: "12.5px" }}>
              Subtotal {fmt$(m.sub)}
            </div>
          )}
          {p.disc ? (
            <div className="muted" style={{ fontSize: "12.5px" }}>
              Discount {p.disc}% −{fmt$(m.disc)}
            </div>
          ) : null}
          {p.tax ? (
            <div className="muted" style={{ fontSize: "12.5px" }}>
              Tax {p.tax}% +{fmt$(m.taxed)}
            </div>
          ) : null}
          <div style={{ fontWeight: 900, fontSize: "19px" }}>Total {fmt$(displayTotal)}</div>
          {p.dep ? (
            <div className="muted" style={{ fontSize: "12px" }}>
              {fmt$(m.dep)} deposit due today · the rest when the job&apos;s done
            </div>
          ) : null}
        </div>

        {est.status === "accepted" ? (
          <div className="deltabanner" style={{ textAlign: "center" }}>
            ✓ Accepted — thank you!
          </div>
        ) : est.status === "declined" ? (
          <div className="reqcard" style={{ textAlign: "center" }}>
            You passed on this one — no hard feelings.
          </div>
        ) : (
          <>
            {/* STUB: approveCust(), Request a change, decline not wired */}
            <button
              className="btn primary"
              style={{ width: "100%", padding: "13px", fontSize: "14.5px", marginTop: "6px" }}
              disabled
            >
              ✓ Approve{p.dep ? ` & pay ${fmt$(m.dep)} deposit` : " quote"}
            </button>
            <button
              className="btn ghost"
              style={{ width: "100%", padding: "11px", marginTop: "8px" }}
              disabled
            >
              Request a change
            </button>
            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <span className="linklike" style={{ opacity: 0.5 }}>
                No thanks
              </span>
            </div>
          </>
        )}
        <p className="muted" style={{ fontSize: "10.5px", textAlign: "center", marginTop: "12px" }}>
          Powered by Mallet — e-sign &amp; secure payment built in
        </p>
      </div>
      <div className="custfoot">Powered by Mallet — e-sign &amp; secure payment built in</div>
    </div>
  );
}

// ---- Main detail page ----
export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const numId = parseInt(id, 10);
  const lead = findLead(numId);

  if (!lead) {
    return <p className="muted" style={{ padding: "20px" }}>Customer not found.</p>;
  }

  const company = lead.companyId != null ? findCompany(lead.companyId) : undefined;
  const ests = SAMPLE_ESTIMATES.filter((e) => e.leadId === lead.id);
  const leadTasks = SAMPLE_TASKS.filter((t) => !t.done && t.leadId === lead.id);

  // The prototype's openLead() shows this layout:
  // avatar + name + stage + source + phone
  // action buttons (Call / Text / Book visit / New quote)
  // quotes card
  // note timeline
  // next step block
  // more details (reveal)

  return (
    <div>
      {/* Lead header — matches prototype openLead() header markup */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "6px" }}>
        <div
          className="avatar"
          style={{
            width: "46px",
            height: "46px",
            background: "var(--green-100)",
            color: "var(--green-900)",
            fontSize: "15px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            fontWeight: 700,
          }}
        >
          {leadInitials(lead.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "18px" }}>{lead.name}</div>
          <div style={{ display: "flex", gap: "7px", alignItems: "center", flexWrap: "wrap", marginTop: "4px" }}>
            <StagePill stage={lead.stage} />
            <SrcPill src={lead.source} />
            {company && (
              <span className="pill src">{company.name}</span>
            )}
            <span className="muted" style={{ fontSize: "13px" }}>{lead.phone}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => router.push("/customers")}>
          ← Back
        </button>
      </div>

      {/* Action buttons — matches prototype openLead() button row */}
      <div style={{ display: "flex", gap: "8px", margin: "14px 0" }}>
        {/* STUB: openCallSheet() not wired */}
        <button className="btn" disabled style={{ opacity: 0.5 }}>
          Call
        </button>
        {/* STUB: openThread() not wired */}
        <button className="btn" disabled style={{ opacity: 0.5 }}>
          Text
          {lead.unread && (
            <span className="pill" style={{ background: "var(--blue-bg)", color: "var(--blue)", marginLeft: "2px" }}>
              new
            </span>
          )}
        </button>
        {!["Won", "Lost"].includes(lead.stage) && (
          /* STUB: openVisitSheet() not wired */
          <button className="btn" disabled style={{ opacity: 0.5 }}>
            Book site visit
          </button>
        )}
        {/* STUB: startComposer() not wired */}
        <button
          className="btn primary"
          disabled
          style={{ opacity: 0.5 }}
        >
          New quote
        </button>
      </div>

      {/* Quotes card */}
      <QuotesSection lead={lead} />

      {/* Note timeline */}
      <NoteTimeline lead={lead} />

      {/* Next step */}
      <div className="card" style={{ marginBottom: "10px" }}>
        <NextStepBlock lead={lead} />
      </div>

      {/* More details (reveal) */}
      <details className="reveal">
        <summary className="reveal-head">
          <span className="caret">▸</span> More details{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — email, address, business
          </span>
        </summary>
        <div className="reveal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Email</label>
              {/* STUB: saveLeadField() not wired */}
              <input type="text" defaultValue={lead.email ?? ""} placeholder="fills itself at first quote" readOnly />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Service address</label>
              <input type="text" defaultValue={lead.address ?? ""} placeholder="fills when a visit gets booked" readOnly />
            </div>
          </div>
          <div className="field" style={{ marginTop: "12px", marginBottom: 0 }}>
            <label>Business</label>
            {company ? (
              <div>
                <span className="pill src">{company.name}</span>
              </div>
            ) : (
              <input type="text" placeholder="type a business name to link or create the account" disabled />
            )}
          </div>
        </div>
      </details>

      {/* GBB / quote viewer section */}
      {ests.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <h3 style={{ marginBottom: "10px" }}>Customer quote view</h3>
          {ests.map((e) => {
            // Check if this estimate has GBB data (none in the sample set, but the
            // renderCustGbb surface is available if gbb is present on the estimate).
            const gbbEst = e as SampleEstimate & { gbb?: GbbData };
            if (gbbEst.gbb && e.status !== "accepted" && e.status !== "declined") {
              return (
                <div key={e.id} className="card" style={{ marginBottom: "14px" }}>
                  <GbbQuoteBuilder est={gbbEst as SampleEstimate & { gbb: GbbData }} lead={lead} />
                </div>
              );
            }
            return (
              <div key={e.id} className="card" style={{ marginBottom: "14px" }}>
                <CustomerQuoteView est={e} lead={lead} />
              </div>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "14px",
          borderTop: "1px solid var(--line)",
          paddingTop: "12px",
        }}
      >
        {/* STUB: openClean() / delete not wired */}
        <button className="btn sm ghost" disabled style={{ opacity: 0.5 }}>
          Clean up — mark Lost or Archive
        </button>
        <button className="btn sm ghost" style={{ color: "var(--red)", opacity: 0.5 }} disabled>
          Delete
        </button>
      </div>
    </div>
  );
}
