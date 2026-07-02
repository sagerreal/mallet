"use client";

/**
 * Settings page — pixel-faithful port of the prototype's vSettings().
 * Uses SAMPLE_* constants from lib/prototype-sample.ts.
 * No live hooks. All backend actions are console-logged stubs.
 *
 * Prototype reference: elas-crm-prototype.html lines 5756–5847.
 *
 * The prototype's setFold() accordion pattern is replicated with a simple
 * React useState open/closed map.  The setwrap / setnav / setbody layout
 * is reproduced exactly with those class names (from prototype.css).
 *
 * Owner-only sections (pricing, booking) are gated behind ROLE = 'owner'.
 * This port hard-codes role = 'owner' (matches sample state.role).
 */

import { useState } from "react";
import {
  SAMPLE_BRAND,
  SAMPLE_USERS,
  SAMPLE_TECHS,
  SAMPLE_ESTIMATES,
  SAMPLE_LEADS,
  type SampleUser,
} from "@/lib/prototype-sample";

// ---- sample state values mirrored from prototype's state -------------------

const ROLE = "owner"; // state.role — owner sees all tabs

// Sources derived from leads (same as prototype: state.sources = [...new Set(state.leads.map...)])
const SOURCES = [...new Set(SAMPLE_LEADS.map((l) => l.source).filter(Boolean))];

// Pipeline stages (prototype's pipelineStages() with no custom stages)
const PIPELINE_STAGES = ["New customer", "Contacted", "Quote Sent", "Won"];
const BUILTIN_STAGE_TRIGGERS: Record<string, string> = {
  "New customer": "a lead is created",
  Contacted: "the first call or text goes out",
  "Quote Sent": "a quote goes out",
  Won: "a quote is accepted",
  Lost: "marked lost — always with a reason",
};

// Pricebook from prototype state
const PRICEBOOK = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650, h: 1, c: 1150 },
  { d: "Remove & haul away existing unit", r: 150, h: 0.5, c: 0 },
  { d: "Expansion tank + seismic straps (code)", r: 385, h: 1, c: 160 },
  { d: "Hydro-jet kitchen drain line", r: 450, h: 1.5, c: 40 },
  { d: "Camera inspection w/ locate", r: 285, h: 1, c: 0 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460, h: 1.5, c: 260 },
  { d: "City permit", r: 110, h: 0, c: 110 },
];

const LABOR_RATES = [
  { id: 1, name: "Standard", rate: 170 },
  { id: 2, name: "After-hours / emergency", rate: 255 },
];

const TERMS_LIB = [
  { t: "Workmanship warranty", body: "All labor guaranteed for 12 months. Manufacturer warranties apply to parts." },
  { t: "Water heater install terms", body: "Price includes haul-away and code compliance. Permit fees billed at cost." },
];

const VISIT_DUR = { scope: 0.5, repair: 1.5, install: 4 };
const MARKUP = 35;
const TRADE = "plumbing";

// Booking playbook
const BOOKING = {
  services: [
    { name: "Water heater repair",          lane: "repair",   triggers: "leaking, no hot water, pilot out, rusty water, water heater not working" },
    { name: "Water heater replacement",     lane: "estimate", triggers: "replace water heater, new water heater, tankless install, old one died" },
    { name: "AC / heating repair",          lane: "repair",   triggers: "not cooling, warm air, no heat, ac stopped, furnace, no power" },
    { name: "AC / system replacement",      lane: "estimate", triggers: "replace my whole, new system, replace my ac, new ac unit" },
    { name: "Drain cleaning",               lane: "flat",     price: 99,  triggers: "drain cleaning, clogged, slow drain, backed up, snake" },
    { name: "Sewer camera inspection",      lane: "flat",     price: 285, triggers: "sewer camera, camera inspection, locate the line" },
    { name: "Leak detection & repair",      lane: "repair",   triggers: "leak, dripping, water damage" },
    { name: "Toilet & fixture install",     lane: "repair",   triggers: "running toilet, leaking toilet, wont flush, faucet" },
    { name: "Whole-house repipe / re-pipe", lane: "estimate", triggers: "repipe, re-pipe, galvanized, whole house repipe, low pressure everywhere, old pipes" },
  ] as Array<{ name: string; lane: string; price?: number; triggers: string }>,
  notServices: "New construction · septic · well pumps",
  serviceFee: 89,
  feeCredited: true,
  hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
  area: { cities: "Pleasanton, Dublin, Livermore, San Ramon", radiusMi: 25 },
};

// Checklists (scope stage only, for the Visit checklists section)
const CHECKLISTS_SCOPE = [
  { id: 1, name: "Water heater",           trade: "Plumbing",   itemCount: 5, requiredCount: 3 },
  { id: 2, name: "Whole-house repipe",     trade: "Plumbing",   itemCount: 6, requiredCount: 4 },
  { id: 3, name: "AC / furnace replacement", trade: "HVAC",     itemCount: 6, requiredCount: 5 },
  { id: 4, name: "Electrical panel upgrade", trade: "Electrical", itemCount: 4, requiredCount: 3 },
];

// Archive counts from sample data (none archived in sample)
const ARCH_LEADS = SAMPLE_LEADS.filter((l) => (l as { archived?: boolean }).archived);
const ARCH_ESTS  = SAMPLE_ESTIMATES.filter((e) => (e as { archived?: boolean }).archived);
const ARCH_COUNT = ARCH_LEADS.length + ARCH_ESTS.length;

// ---- stubs ------------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ---- helpers ----------------------------------------------------------------

function cap(s: string): string {
  return s ? (s[0] ?? "").toUpperCase() + s.slice(1) : "";
}

function timeLabel(h: number): string {
  if (!h) return "closed";
  const period = h < 12 ? "a" : "p";
  const dh = h > 12 ? h - 12 : h;
  return `${dh}${period}`;
}

function pbMarginPct(p: { r: number; c: number }): number {
  if (!p.r) return 0;
  return Math.round(((p.r - p.c) / p.r) * 100);
}

// ---- FoldCard component -----------------------------------------------------

interface FoldCardProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function FoldCard({ title, summary, defaultOpen = false, children }: FoldCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`foldcard${open ? " open" : ""}`}>
      <div className="fhead" onClick={() => setOpen((v) => !v)}>
        <span className="caret">▸</span>
        <h3 dangerouslySetInnerHTML={{ __html: title }} />
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  );
}

// ============================================================================
// Section: Workspace
// ============================================================================

function SecWorkspace() {
  return (
    <>
      <FoldCard title="Branding" summary={SAMPLE_BRAND.name}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="custlogo" style={{ background: SAMPLE_BRAND.color, color: "#fff" }}>
            {SAMPLE_BRAND.initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{SAMPLE_BRAND.name}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {SAMPLE_BRAND.tagline} · {SAMPLE_BRAND.site}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => stub("previewBrandQuote")}>
            Preview a quote
          </button>
        </div>
      </FoldCard>

      <FoldCard title="Guided demos" summary="replay">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => stub("startJobTour")}>
            Full demo — new customer to paid
          </button>
          <button className="btn" onClick={() => stub("startEstimateTour")}>
            AI Front Desk — missed call to booked job
          </button>
        </div>
      </FoldCard>

      {ROLE === "owner" && (
        <>
          <h3 className="setgrp" style={{ margin: "20px 0 10px" }}>
            Team &amp; roles
          </h3>
          <TeamRolesBlock />
        </>
      )}
    </>
  );
}

// ============================================================================
// Team & roles
// ============================================================================

function TeamRow({ u }: { u: SampleUser }) {
  const linkedTech = u.techId ? SAMPLE_TECHS.find((t) => t.id === u.techId) : null;
  return (
    <div className="stage-row">
      <div style={{ flex: 1 }}>
        <b style={{ fontWeight: 700 }}>{u.name}</b>
        <div className="muted" style={{ fontSize: "11.5px", marginTop: 3, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>{u.email} · login</span>
          <span>
            {u.mobile ? (
              u.mobileVerified ? (
                <>{u.mobile} · <span style={{ color: "var(--green-900)", fontWeight: 600 }}>verified ✓</span></>
              ) : (
                <>{u.mobile} · <span className="linklike" onClick={() => stub("verifyMobile", u.id)}>verify</span></>
              )
            ) : (
              <span className="linklike" onClick={() => stub("addMobile", u.id)}>+ add work phone</span>
            )}
          </span>
        </div>
        {linkedTech && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            Field crew · {linkedTech.skills.join(", ")}
          </div>
        )}
      </div>
      <select
        className="tsel"
        defaultValue={u.role}
        onChange={(e) => stub("setUserRole", u.id, e.target.value)}
      >
        <option value="owner">Owner</option>
        <option value="office">Office</option>
        <option value="tech">Tech</option>
      </select>
      <button className="btn sm ghost" onClick={() => stub("removeUser", u.id)}>
        ✕
      </button>
    </div>
  );
}

function TeamRolesBlock() {
  return (
    <>
      <FoldCard title="Your team" defaultOpen summary={`${SAMPLE_USERS.length} people`}>
        {SAMPLE_USERS.map((u) => (
          <TeamRow key={u.id} u={u} />
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <input id="invName" placeholder="name" style={{ flex: 1, minWidth: 110, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
          <input id="invEmail" placeholder="email · login" style={{ flex: 1, minWidth: 130, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
          <input id="invMobile" placeholder="mobile · work phone" style={{ flex: 1, minWidth: 130, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
          <select className="tsel" id="invRole">
            <option value="office">Office</option>
            <option value="tech">Tech</option>
            <option value="owner">Owner</option>
          </select>
          <button className="btn primary" onClick={() => stub("inviteUser")}>+ Add</button>
        </div>
        <div className="muted" style={{ fontSize: "11.5px", marginTop: 9 }}>
          Add a Tech and they become schedulable field crew with the My Day app.
        </div>
      </FoldCard>

      <FoldCard title="Sensitive data" summary="permissions">
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b>Techs can see job prices</b>
            <div className="muted" style={{ fontSize: 12 }}>The job total only — your cost and margin stay owner-only.</div>
          </div>
          <label className="switch">
            <input type="checkbox" defaultChecked onChange={(e) => stub("setPermTechSeesPrice", e.target.checked)} />
            <i />
          </label>
        </div>
        <div className="stage-row">
          <div style={{ flex: 1 }}>
            <b>Techs can text customers</b>
            <div className="muted" style={{ fontSize: 12 }}>From your business number; threads stay visible to the office.</div>
          </div>
          <label className="switch">
            <input type="checkbox" defaultChecked onChange={(e) => stub("setPermTechTexts", e.target.checked)} />
            <i />
          </label>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Lead sources
// ============================================================================

function SecSources() {
  return (
    <>
      <FoldCard title="AI Front Desk" defaultOpen summary="Off">
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700 }}>Front Desk</b>
            <div className="muted" style={{ fontSize: 12 }}>
              Answers calls &amp; texts you miss, books a slot, holds it for your one-tap yes.
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" onChange={(e) => stub("setFrontDesk", e.target.checked)} />
            <i />
          </label>
        </div>
        <div className="muted" style={{ fontSize: "11.5px", marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--line)" }}>
          Unknown number → Front Desk, handled as a lead. A <b>verified crew phone</b> → your assistant — never the Front Desk.
        </div>
        <div className="rail muted" style={{ marginTop: 10, fontSize: 12 }}>
          Off — missed calls go to voicemail. On — they text back, parsed and held for your yes.
        </div>
      </FoldCard>

      <h3 className="setgrp" style={{ margin: "20px 0 10px" }}>
        Ways leads reach you
      </h3>

      <FoldCard title="Your Mallet number" summary="(925) 555-0100">
        <div className="hookurl">
          <code>(925) 555-0100</code>
          <button className="btn sm" onClick={() => stub("copyMalletNumber")}>Copy</button>
        </div>
        <p className="muted" style={{ marginTop: 9, fontSize: "11.5px" }}>
          Your business line. Customers call &amp; text this; it rings your crew and every reply goes out as this number — personal cells stay private.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => stub("numAction", "forward")}>Forward your existing number</button>
          <button className="btn sm ghost" onClick={() => stub("numAction", "port")}>Port your number in</button>
        </div>
      </FoldCard>

      <FoldCard title="Lead marketplaces" summary="Angi · Thumbtack · Google · Yelp">
        {[
          { name: "Angi", k: "angi" },
          { name: "Thumbtack", k: "thumbtack" },
          { name: "Google LSA", k: "google-lsa" },
          { name: "Yelp", k: "yelp" },
        ].map((c) => (
          <div key={c.k} className="stage-row">
            <span style={{ fontWeight: 700 }}>{c.name}</span>
            <span className="trig">Not connected</span>
            <button className="btn sm primary" onClick={() => stub("toggleChannel", c.k)}>Connect</button>
          </div>
        ))}
      </FoldCard>

      <FoldCard title="Import customers" summary="QuickBooks · CSV">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => stub("openImport", "QuickBooks")}>Import from QuickBooks</button>
          <button className="btn" onClick={() => stub("openImport", "Google Contacts")}>Google Contacts</button>
          <button className="btn ghost" onClick={() => stub("openImport", "a spreadsheet")}>Upload a spreadsheet</button>
        </div>
      </FoldCard>

      <FoldCard title="Source list" summary={`${SOURCES.length} sources`}>
        {SOURCES.length > 0 ? (
          SOURCES.map((s) => {
            const count = SAMPLE_LEADS.filter((l) => l.source === s).length;
            return (
              <div key={s} className="stage-row">
                <span style={{ fontWeight: 700 }}>{s}</span>
                <span className="trig">{count} lead{count === 1 ? "" : "s"}</span>
                <button className="btn sm ghost" onClick={() => stub("removeSource", s)}>✕</button>
              </div>
            );
          })
        ) : (
          <div className="empty-att">
            Empty — a brand-new shop starts blank and builds its own list from the first lead.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="setSrcName" placeholder="e.g. Home show, Truck wrap"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addSourceFromSettings")}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Pipeline
// ============================================================================

function SecPipeline() {
  const allStages = [...PIPELINE_STAGES, "Lost"];

  function StageRow({ s }: { s: string }) {
    const trigger = BUILTIN_STAGE_TRIGGERS[s] ?? "";
    const pillCls =
      s === "New customer" ? "stamp ink" :
      s === "Contacted"    ? "stamp info" :
      s === "Quote Sent"   ? "stamp warn" :
      s === "Won"          ? "stamp good" :
                             "stamp bad";

    return (
      <div className="stage-row">
        <span style={{ fontWeight: 700 }}>{s}</span>
        <span className={pillCls}>{s}</span>
        <span className="trig">{trigger}</span>
        <button className="btn sm ghost" onClick={() => stub("renameStage", s)}>Rename</button>
      </div>
    );
  }

  return (
    <>
      <FoldCard title="Pipeline stages" defaultOpen summary={`${PIPELINE_STAGES.length} stages`}>
        <div>
          {allStages.map((s) => (
            <StageRow key={s} s={s} />
          ))}
        </div>
        <div style={{ padding: "14px 6px 4px" }}>
          <button className="btn" onClick={() => stub("openStageModal")}>+ Add a stage</button>
        </div>
      </FoldCard>

      <FoldCard title="Visit checklists" summary={`${CHECKLISTS_SCOPE.length} lists`}>
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700 }}>Visit checks</b>
            <div className="muted" style={{ fontSize: 12 }}>
              A per-job-type checklist on the site visit; flags what&apos;s missing before you quote.
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" onChange={(e) => stub("setScopeOn", e.target.checked)} />
            <i />
          </label>
        </div>
        {CHECKLISTS_SCOPE.map((c) => (
          <div key={c.id} className="stage-row">
            <span style={{ fontWeight: 700 }}>{c.name}</span>
            <span className="trig">{c.trade} · {c.itemCount} items · {c.requiredCount} required</span>
            <button className="btn sm" onClick={() => stub("openChk", c.id)}>Edit</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" id="chkNew" placeholder="job type — e.g. Sump pump"
            style={{ flex: 1, minWidth: 140, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("newBlankChecklist")}>+ Create blank</button>
          <span className="linklike" style={{ fontSize: 12 }} onClick={() => stub("openSopPaste")}>paste an SOP</span>
        </div>
      </FoldCard>

      <FoldCard
        title="Visit lengths"
        summary={`${Math.round(VISIT_DUR.scope * 60)} · ${Math.round(VISIT_DUR.repair * 60)} · ${Math.round(VISIT_DUR.install * 60)} min`}
      >
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {(["scope", "repair", "install"] as const).map((k) => {
            const lbl = k === "scope" ? "Scope / look" : k === "repair" ? "Repair" : "Install";
            return (
              <div key={k} className="field" style={{ margin: 0 }}>
                <label>{lbl} (min)</label>
                <input
                  type="number"
                  min={15}
                  defaultValue={Math.round(VISIT_DUR[k] * 60)}
                  onChange={(e) => stub("setVisitDur", k, e.target.value)}
                  style={{ width: 96 }}
                />
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          A planning estimate for the schedule block — the real time is clocked Arrived → Done.
        </p>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Pricing & quotes
// ============================================================================

function SecPricing() {
  return (
    <>
      <FoldCard title="Your trade" summary={cap(TRADE)}>
        <select
          id="setTrade"
          defaultValue={TRADE}
          onChange={(e) => stub("setTradeFromSettings", e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: 13 }}
        >
          {[["plumbing","Plumbing"],["hvac","HVAC"],["electrical","Electrical"],["remodel","Remodeling"],["fence","Fencing"],["other","Other / general"]].map(([v,l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Switching reloads that trade&apos;s starter pricebook &amp; labor rates.
        </p>
      </FoldCard>

      <FoldCard title="Labor rates" defaultOpen summary={`${LABOR_RATES.length} rate${LABOR_RATES.length === 1 ? "" : "s"}`}>
        <div>
          {LABOR_RATES.map((lr) => (
            <div key={lr.id} className="stage-row">
              <input type="text" defaultValue={lr.name}
                onChange={(e) => stub("setLaborField", lr.id, "name", e.target.value)}
                style={{ flex: 1, minWidth: 120, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input type="number" defaultValue={lr.rate}
                  onChange={(e) => stub("setLaborField", lr.id, "rate", e.target.value)}
                  style={{ width: 80, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
                <span className="muted" style={{ fontSize: 12 }}>/hr</span>
              </span>
              {LABOR_RATES.length > 1 && (
                <button className="btn sm ghost" onClick={() => stub("removeLaborRate", lr.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="lrName" placeholder="e.g. Apprentice, Weekend"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="lrRate" placeholder="$/hr"
            style={{ flex: "0 0 100px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addLaborRate")}>+ Add</button>
        </div>
      </FoldCard>

      <FoldCard title="Pricebook" summary={`${PRICEBOOK.length} lines`}>
        <div>
          {PRICEBOOK.map((p, i) => (
            <div key={i} className="stage-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input type="text" defaultValue={p.d}
                onChange={(e) => stub("setPbField", i, "d", e.target.value)}
                style={{ flex: 1, minWidth: 150, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input type="number" defaultValue={p.r}
                  onChange={(e) => stub("setPbField", i, "r", e.target.value)}
                  style={{ width: 78, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted" style={{ fontSize: 11 }}>cost</span>
                <input type="number" defaultValue={p.c}
                  onChange={(e) => stub("setPbField", i, "c", e.target.value)}
                  style={{ width: 64, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span className="muted" style={{ fontSize: "11.5px", minWidth: 62, textAlign: "right" }}>
                {p.c ? `${pbMarginPct(p)}% margin` : ""}
              </span>
              <button className="btn sm ghost" onClick={() => stub("removePbItem", i)}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="pbName" placeholder="e.g. Sewer camera inspection"
            style={{ flex: 2, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="pbRate" placeholder="price $"
            style={{ flex: "0 0 92px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="pbCost" placeholder="cost $"
            style={{ flex: "0 0 92px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addPbFromSettings")}>+ Add</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => stub("openPbImport")}>Upload price book</button>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Enter a cost and the price pre-fills at your default markup. Techs never see cost or margin.
        </p>
      </FoldCard>

      <FoldCard title="Default parts markup" summary={`${MARKUP}%`}>
        <div className="field" style={{ maxWidth: 200, margin: 0 }}>
          <label>Markup on new parts (%)</label>
          <input type="number" defaultValue={MARKUP} onChange={(e) => stub("setMarkup", e.target.value)} />
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Only pre-fills the suggested price — each pricebook line keeps its own margin.
        </p>
      </FoldCard>

      <FoldCard title="Terms library" summary={`${TERMS_LIB.length} terms`}>
        <div>
          {TERMS_LIB.map((t, i) => (
            <div key={i} className="stage-row">
              <span style={{ fontWeight: 700 }}>{t.t}</span>
              <span className="trig" style={{ maxWidth: 280, whiteSpace: "normal" }}>{t.body.slice(0, 60)}…</span>
              <button className="btn sm ghost" onClick={() => stub("removeTerm", i)}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="tlName" placeholder="name (e.g. Repipe terms)"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="text" id="tlBody" placeholder="the fine print…"
            style={{ flex: 2, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addTermFromSettings")}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Booking
// ============================================================================

function SecBooking() {
  const bk = BOOKING;
  const wdLabel = `${timeLabel(bk.hours.wdOpen)}–${timeLabel(bk.hours.wdClose)} wkdays`;

  type HoursKey = keyof typeof bk.hours;

  function HrRow({ lbl, oKey, cKey }: { lbl: string; oKey: HoursKey; cKey: HoursKey }) {
    const ov = bk.hours[oKey];
    const cv = bk.hours[cKey];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
        <span style={{ minWidth: 84, fontWeight: 600, fontSize: "12.5px" }}>{lbl}</span>
        <input type="number" min={0} max={23} defaultValue={ov}
          onChange={(e) => stub("bkSet", "hours", oKey, e.target.value)}
          style={{ width: 58, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
        <span className="muted">to</span>
        <input type="number" min={0} max={24} defaultValue={cv}
          onChange={(e) => stub("bkSet", "hours", cKey, e.target.value)}
          style={{ width: 58, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
        <span className="muted" style={{ fontSize: "11.5px" }}>
          {ov || cv ? `${timeLabel(ov)}–${timeLabel(cv)}` : "closed"}
        </span>
      </div>
    );
  }

  return (
    <>
      <h3 className="setgrp" style={{ margin: "2px 0 12px" }}>
        Booking playbook{" "}
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--ink-3)" }}>
          · what your AI Front Desk reads to triage &amp; book
        </span>
      </h3>

      <FoldCard title="Services &amp; routing" defaultOpen summary={`${bk.services.length} services`}>
        <div>
          {bk.services.map((s, i) => (
            <div key={i} className="stage-row" style={{ gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--line-2)", paddingBottom: 8 }}>
              <input type="text" defaultValue={s.name}
                onChange={(e) => stub("bkSetService", i, "name", e.target.value)}
                style={{ flex: 1, minWidth: 130, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
              <select defaultValue={s.lane}
                onChange={(e) => stub("bkSetService", i, "lane", e.target.value)}
                style={{ border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }}>
                <option value="repair">Job — diagnose &amp; price on site</option>
                <option value="estimate">Estimate visit — scope it, then quote</option>
                <option value="flat">Job — flat price on the call</option>
              </select>
              {s.lane === "flat" && (
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span className="muted">$</span>
                  <input type="number" min={0} defaultValue={s.price ?? 0}
                    onChange={(e) => stub("bkSetService", i, "price", e.target.value)}
                    style={{ width: 64, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
                </span>
              )}
              <button className="btn sm ghost" onClick={() => stub("bkRmService", i)}>✕</button>
              <input type="text" defaultValue={s.triggers}
                onChange={(e) => stub("bkSetService", i, "triggers", e.target.value)}
                placeholder="trigger words — e.g. leaking, no hot water"
                style={{ flexBasis: "100%", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input type="text" id="bkSvc" placeholder="add a service — e.g. Tankless install"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("bkAddService")}>+ Add</button>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>We don&apos;t do</label>
          <input type="text" defaultValue={bk.notServices}
            onChange={(e) => stub("bkSetField", "notServices", e.target.value)}
            placeholder="e.g. new construction, septic"
            style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
        </div>
      </FoldCard>

      <FoldCard title="Service-call fee" summary={`$${bk.serviceFee}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="muted">$</span>
          <input type="number" min={0} defaultValue={bk.serviceFee}
            onChange={(e) => stub("bkSetFee", e.target.value)}
            style={{ width: 80, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          <span className="muted" style={{ fontSize: 12 }}>to come diagnose a repair</span>
        </div>
        <div className="stage-row" style={{ marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700, fontSize: "13.5px" }}>Credited toward the work</b>
            <div className="muted" style={{ fontSize: "11.5px" }}>Comes off the price if they approve the repair.</div>
          </div>
          <label className="switch">
            <input type="checkbox" defaultChecked={bk.feeCredited}
              onChange={(e) => stub("bkSetFeeCredited", e.target.checked)} />
            <i />
          </label>
        </div>
      </FoldCard>

      <FoldCard title="Hours &amp; service area" summary={wdLabel}>
        <div>
          <HrRow lbl="Weekdays" oKey="wdOpen" cKey="wdClose" />
          <HrRow lbl="Saturday" oKey="satOpen" cKey="satClose" />
          <HrRow lbl="Sunday"   oKey="sunOpen" cKey="sunClose" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Cities / area served</label>
            <input type="text" defaultValue={bk.area.cities}
              onChange={(e) => stub("bkSet", "area", "cities", e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Radius (mi)</label>
            <input type="number" min={0} defaultValue={bk.area.radiusMi}
              onChange={(e) => stub("bkSet", "area", "radiusMi", e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          </div>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Custom fields
// ============================================================================

function SecFields() {
  return (
    <>
      <FoldCard title="Custom fields" defaultOpen summary="0 fields">
        <div className="empty-att">
          None yet — add one here, or from any lead&apos;s More details.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="setCfName" placeholder="e.g. Gate code"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addCustomFieldFromSettings")}>+ Add</button>
        </div>
      </FoldCard>

      <FoldCard title="Company custom fields" summary="0">
        <div className="empty-att">
          None yet — add one here, or from any company&apos;s Details.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="setCoCfName" placeholder="e.g. Account number, Region"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => stub("addCoCfFromSettings")}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Archive
// ============================================================================

function SecArchive() {
  const count = ARCH_COUNT;

  return (
    <FoldCard
      title="Archive"
      defaultOpen
      summary={count ? `${count} item${count === 1 ? "" : "s"}` : "empty"}
    >
      {ARCH_LEADS.map((l) => (
        <div key={l.id} className="stage-row">
          <span style={{ fontWeight: 700 }}>{l.name}</span>
          <span className="trig">lead · {l.job} · {l.source}</span>
          <button className="btn sm" onClick={() => stub("restoreLead", l.id)}>↩ Restore</button>
        </div>
      ))}
      {ARCH_ESTS.map((e) => (
        <div key={e.id} className="stage-row">
          <span style={{ fontWeight: 700 }}>{e.num} — {e.title}</span>
          <span className="trig">quote · {e.status}</span>
          <button className="btn sm" onClick={() => stub("restoreQuote", e.id)}>↩ Restore</button>
        </div>
      ))}
      {count === 0 && (
        <div className="empty-att">
          Nothing archived. Anything you archive — leads, quotes, companies, jobs — lands here, recoverable.
        </div>
      )}
    </FoldCard>
  );
}

// ============================================================================
// Main page
// ============================================================================

type SetTab = "workspace" | "sources" | "pipeline" | "pricing" | "booking" | "fields" | "archive";

interface SectionDef {
  k: SetTab;
  label: string;
  ownerOnly?: boolean;
  body: React.ReactNode;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SetTab>("workspace");

  const allSections = [
    { k: "workspace" as SetTab, label: "Workspace",         body: <SecWorkspace /> },
    { k: "sources"   as SetTab, label: "Lead sources",      body: <SecSources /> },
    { k: "pipeline"  as SetTab, label: "Pipeline",          body: <SecPipeline /> },
    { k: "pricing"   as SetTab, label: "Pricing & quotes", ownerOnly: true, body: <SecPricing /> },
    { k: "booking"   as SetTab, label: "Booking",           ownerOnly: true, body: <SecBooking /> },
    { k: "fields"    as SetTab, label: "Custom fields",     body: <SecFields /> },
    { k: "archive"   as SetTab, label: "Archive",           body: <SecArchive /> },
  ] satisfies SectionDef[];
  const sections: SectionDef[] = allSections.filter((s) => ROLE === "owner" || !s.ownerOnly);

  const tab = sections.some((s) => s.k === activeTab) ? activeTab : "workspace";

  return (
    <div>
      <h1>Settings</h1>
      <div className="sub">Your workspace and how Mallet works.</div>

      <div className="setwrap">
        <nav className="setnav">
          {sections.map((s) => (
            <div
              key={s.k}
              className={`navitem${tab === s.k ? " active" : ""}`}
              onClick={() => setActiveTab(s.k)}
            >
              <span>{s.label}</span>
            </div>
          ))}
        </nav>

        <div className="setbody">
          {sections.map((s) => (
            <div key={s.k} style={{ display: tab === s.k ? "block" : "none" }}>
              {s.body}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
