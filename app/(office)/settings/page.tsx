"use client";

/**
 * Settings page — pixel-faithful port of the prototype's vSettings().
 * Editable config lives in the Zustand store (settings-slice); this page reads
 * it via useAppStore and wires every field/toggle/CRUD row to a store action.
 *
 * Prototype reference: elas-crm-prototype.html lines 5756–5847.
 *
 * The prototype's setFold() accordion pattern is replicated with a simple
 * React useState open/closed map.  The setwrap / setnav / setbody layout
 * is reproduced exactly with those class names (from prototype.css).
 *
 * Office-only sections (pricing, booking) are gated behind ROLE = 'office'.
 * Two roles exist: 'office' (the back office / boss — full access) and 'tech'
 * (field crew, who never reach this page). This port hard-codes role = 'office'.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { BrandingCard } from "./branding-card";
import { WebsiteFormCard } from "./website-form-card";
import { LeadMarketplacesCard } from "./lead-marketplaces-card";
import { FoldCard } from "./fold-card";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";

// ---- sample state values mirrored from prototype's state -------------------

const MALLET_NUMBER = "(925) 555-0100";

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

function pbMarginPct(p: { unitPrice: number; cost: number }): number {
  if (!p.unitPrice) return 0;
  return Math.round(((p.unitPrice - p.cost) / p.unitPrice) * 100);
}

// ============================================================================
// Section: Workspace
// ============================================================================

function SecWorkspace({ role }: { role: string }) {
  return (
    <>
      <BrandingCard />

      {(role === "owner" || role === "office") && (
        <>
          <h3 className="setgrp" style={{ margin: "20px 0 10px" }}>
            Your account
          </h3>
          <YourNameField />
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
// Your Name — prefilled from me query, saved via updateMe mutation
// ============================================================================

function YourNameField() {
  const { data: me } = api.v1.identity.me.useQuery();
  const utils = api.useUtils();
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateMe = api.v1.identity.updateMe.useMutation({
    onSuccess: () => {
      setSaved(true);
      setSaveError(null);
      utils.v1.identity.me.invalidate().catch(() => {});
      utils.v1.identity.members.invalidate().catch(() => {});
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => {
      setSaveError(err.message);
    },
  });

  const displayName = name ?? me?.name ?? "";

  function handleSave() {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSaved(false);
    setSaveError(null);
    updateMe.mutate({ name: trimmed });
  }

  return (
    <FoldCard title="Your name" defaultOpen summary={me?.name ?? me?.email ?? ""}>
      <div className="muted" style={{ fontSize: "11.5px", marginBottom: 8 }}>
        Shown in greetings and on the dispatch board. Your login email stays unchanged.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="e.g. Mike Rivera"
          value={displayName}
          onChange={(e) => { setName(e.target.value); setSaved(false); setSaveError(null); }}
          style={{ flex: 1, minWidth: 180, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }}
        />
        <button
          className="btn primary"
          disabled={updateMe.isPending || !displayName.trim()}
          onClick={handleSave}
        >
          {updateMe.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ color: "var(--green-900)", fontSize: 12, fontWeight: 600 }}>Saved ✓</span>}
      </div>
      {saveError && (
        <div style={{ color: "var(--red-700)", fontSize: 12, marginTop: 6 }}>{saveError}</div>
      )}
    </FoldCard>
  );
}

// ============================================================================
// Team & roles — consolidated onto real DB members (v1.identity.members)
// ============================================================================

type MemberItem = {
  id: string;
  email: string;
  role: "owner" | "office" | "tech";
  name: string | null;
  isFieldCrew: boolean;
};

function MemberRow({ member }: { member: MemberItem }) {
  const utils = api.useUtils();
  const [roleError, setRoleError] = useState<string | null>(null);

  const setFieldCrew = api.v1.identity.setMemberFieldCrew.useMutation({
    onSuccess: () => { utils.v1.identity.members.invalidate().catch(() => {}); },
  });

  const setRole = api.v1.identity.setMemberRole.useMutation({
    onSuccess: () => {
      setRoleError(null);
      utils.v1.identity.members.invalidate().catch(() => {});
    },
    onError: (err) => {
      setRoleError(err.message);
    },
  });

  return (
    <div className="stage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontWeight: 700 }}>{member.name ?? member.email}</b>
          <div className="muted" style={{ fontSize: "11.5px", marginTop: 2 }}>
            {member.email}
          </div>
        </div>
        <select
          className="tsel"
          value={member.role}
          disabled={setRole.isPending}
          onChange={(e) => {
            const role = e.target.value as "owner" | "office" | "tech";
            setRoleError(null);
            setRole.mutate({ userId: member.id, role });
          }}
        >
          <option value="owner">Owner</option>
          <option value="office">Office</option>
          <option value="tech">Tech</option>
        </select>
        <label className="switch" title="Schedulable field crew">
          <input
            type="checkbox"
            checked={member.isFieldCrew}
            disabled={setFieldCrew.isPending}
            onChange={(e) => setFieldCrew.mutate({ userId: member.id, isFieldCrew: e.target.checked })}
          />
          <i />
        </label>
      </div>
      {roleError && (
        <div style={{ color: "var(--red-700)", fontSize: 12, paddingLeft: 2 }}>{roleError}</div>
      )}
    </div>
  );
}

// ---- email validation helper -------------------------------------------------

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ---- InviteForm -------------------------------------------------------------

type InviteStatus =
  | { kind: "idle" }
  | { kind: "email_sent" }
  | { kind: "no_email"; reason: string | undefined };

function InviteForm() {
  const utils = api.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "office" | "tech">("tech");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>({ kind: "idle" });

  const inviteMember = api.v1.identity.inviteMember.useMutation({
    onSuccess: (data) => {
      setEmail("");
      setRole("tech");
      setInviteError(null);
      setInviteStatus(
        data.emailSent
          ? { kind: "email_sent" }
          : { kind: "no_email", reason: data.emailReason },
      );
      utils.v1.identity.listInvites.invalidate().catch(() => {});
      utils.v1.identity.members.invalidate().catch(() => {});
      setTimeout(() => setInviteStatus({ kind: "idle" }), 4000);
    },
    onError: (err) => {
      setInviteError(err.message);
    },
  });

  const emailTrimmed = email.trim();
  const canSubmit = emailTrimmed.length > 0 && looksLikeEmail(emailTrimmed) && !inviteMember.isPending;

  function handleInvite() {
    if (!canSubmit) return;
    setInviteError(null);
    setInviteStatus({ kind: "idle" });
    inviteMember.mutate({ email: emailTrimmed, role });
  }

  function InviteConfirmation() {
    if (inviteStatus.kind === "email_sent") {
      return (
        <span style={{ color: "var(--green-900)", fontSize: 12, fontWeight: 600 }}>
          Invite email sent ✓
        </span>
      );
    }
    if (inviteStatus.kind === "no_email") {
      return (
        <span style={{ color: "var(--amber-700, #b45309)", fontSize: 12, fontWeight: 600 }}>
          Invite created — ask them to sign up with this email
        </span>
      );
    }
    return null;
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder="teammate@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setInviteError(null); setInviteStatus({ kind: "idle" }); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
          style={{ flex: 1, minWidth: 180, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }}
        />
        <select
          className="tsel"
          value={role}
          onChange={(e) => setRole(e.target.value as "owner" | "office" | "tech")}
        >
          <option value="tech">Tech</option>
          <option value="office">Office</option>
          <option value="owner">Owner</option>
        </select>
        <button
          className="btn primary"
          disabled={!canSubmit}
          onClick={handleInvite}
        >
          {inviteMember.isPending ? "Inviting…" : "Invite"}
        </button>
        <InviteConfirmation />
      </div>
      {inviteError && (
        <div style={{ color: "var(--red-700)", fontSize: 12, marginTop: 6 }}>{inviteError}</div>
      )}
      <div className="muted" style={{ fontSize: "11.5px", marginTop: 6 }}>
        They&apos;ll receive an invite link. If they already have an account, ask them to sign in.
      </div>
    </div>
  );
}

// ---- PendingInvitesList -----------------------------------------------------

type InviteItem = {
  id: string;
  email: string;
  role: "owner" | "office" | "tech";
  status: string;
  createdAt: Date;
};

function PendingInviteRow({ invite }: { invite: InviteItem }) {
  const utils = api.useUtils();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const revokeInvite = api.v1.identity.revokeInvite.useMutation({
    onSuccess: () => {
      setRevokeError(null);
      utils.v1.identity.listInvites.invalidate().catch(() => {});
    },
    onError: (err) => {
      setRevokeError(err.message);
    },
  });

  return (
    <div className="stage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{invite.email}</span>
          <span className="muted" style={{ fontSize: "11.5px", marginLeft: 8 }}>{cap(invite.role)} · pending</span>
        </div>
        <button
          className="btn sm ghost"
          disabled={revokeInvite.isPending}
          onClick={() => revokeInvite.mutate({ inviteId: invite.id })}
        >
          {revokeInvite.isPending ? "…" : "Revoke"}
        </button>
      </div>
      {revokeError && (
        <div style={{ color: "var(--red-700)", fontSize: 12, paddingLeft: 2 }}>{revokeError}</div>
      )}
    </div>
  );
}

function PendingInvitesList() {
  const { data, isLoading } = api.v1.identity.listInvites.useQuery();

  if (isLoading) {
    return <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>Loading invites…</div>;
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "11.5px", padding: "6px 0" }}>
        No pending invites.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {items.map((invite) => (
        <PendingInviteRow key={invite.id} invite={invite} />
      ))}
    </div>
  );
}

// ---- TeamRolesBlock ---------------------------------------------------------

function TeamRolesBlock() {
  const { data, isLoading, isError } = api.v1.identity.members.useQuery();
  const setToggle = useAppStore((s) => s.setToggle);
  const techSeesPrice = useAppStore((s) => s.toggles.techSeesPrice);

  const memberCount = data?.items.length ?? 0;
  const fieldCrewCount = data?.items.filter((m) => m.isFieldCrew).length ?? 0;

  return (
    <>
      <FoldCard title="Your team" defaultOpen summary={isLoading ? "…" : `${memberCount} ${memberCount === 1 ? "person" : "people"}`}>
        {isLoading && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>Loading members…</div>
        )}
        {isError && (
          <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>Could not load members.</div>
        )}
        {data?.items.map((member) => (
          <MemberRow key={member.id} member={member} />
        ))}
        <InviteForm />
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div className="muted" style={{ fontSize: "11.5px", fontWeight: 600, marginBottom: 4 }}>Pending invites</div>
          <PendingInvitesList />
        </div>
        <div className="muted" style={{ fontSize: "11.5px", marginTop: 8 }}>
          The toggle makes a member schedulable on the dispatch board ({fieldCrewCount} on now).
        </div>
      </FoldCard>

      <FoldCard title="Sensitive data" summary="permissions">
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b>Techs can see job prices</b>
            <div className="muted" style={{ fontSize: 12 }}>The job total only — your cost and margin stay office-only.</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={techSeesPrice} onChange={(e) => setToggle("techSeesPrice", e.target.checked)} />
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
  const sources = useAppStore((s) => s.sources);
  const leads = useAppStore((s) => s.leads);
  const addSource = useAppStore((s) => s.addSource);
  const removeSource = useAppStore((s) => s.removeSource);
  const setToggle = useAppStore((s) => s.setToggle);
  const frontDesk = useAppStore((s) => s.toggles.frontDesk);
  const openModal = useOpenModal();

  const [srcName, setSrcName] = useState("");

  function handleAddSource() {
    addSource(srcName);
    setSrcName("");
  }

  return (
    <>
      <FoldCard title="AI Front Desk" defaultOpen summary={frontDesk ? "On" : "Off"}>
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700 }}>Front Desk</b>
            <div className="muted" style={{ fontSize: 12 }}>
              Answers calls &amp; texts you miss, books a slot, holds it for your one-tap yes.
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={frontDesk} onChange={(e) => setToggle("frontDesk", e.target.checked)} />
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

      <FoldCard title="Your Mallet number" summary={MALLET_NUMBER}>
        <div className="hookurl">
          <code>{MALLET_NUMBER}</code>
          <button className="btn sm" onClick={() => navigator.clipboard.writeText(MALLET_NUMBER)}>Copy</button>
        </div>
        <p className="muted" style={{ marginTop: 9, fontSize: "11.5px" }}>
          Your business line. Customers call &amp; text this; it rings your crew and every reply goes out as this number — personal cells stay private.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
          {/* deferred: external integration (forward existing number) */}
          <button className="btn sm" onClick={() => {}}>Forward your existing number</button>
          {/* deferred: external integration (port number in) */}
          <button className="btn sm ghost" onClick={() => {}}>Port your number in</button>
        </div>
      </FoldCard>

      <LeadMarketplacesCard />

      <FoldCard title="Import customers" summary="CSV">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Coming from QuickBooks, Google Contacts, or another tool? Export a CSV and upload it here.
        </p>
        <button className="btn primary" onClick={() => openModal(MODAL.IMPORT_CUSTOMERS)}>
          Upload a spreadsheet (CSV)
        </button>
      </FoldCard>

      <WebsiteFormCard />

      <FoldCard title="Source list" summary={`${sources.length} sources`}>
        {sources.length > 0 ? (
          sources.map((s) => {
            const count = leads.filter((l) => l.source === s.label).length;
            return (
              <div key={s.id} className="stage-row">
                <span style={{ fontWeight: 700 }}>{s.label}</span>
                <span className="trig">{count} lead{count === 1 ? "" : "s"}</span>
                <button className="btn sm ghost" onClick={() => removeSource(s.id)}>✕</button>
              </div>
            );
          })
        ) : (
          <div className="empty-att">
            Empty — a brand-new shop starts blank and builds its own list from the first lead.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="setSrcName" placeholder="e.g. Home show, Truck wrap" value={srcName} onChange={(e) => setSrcName(e.target.value)}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddSource}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Pipeline
// ============================================================================

function SecPipeline() {
  const checklists = useAppStore((s) => s.checklists);
  const scopeChecklists = checklists.filter((c) => c.stage === "scope");
  const addChecklist = useAppStore((s) => s.addChecklist);
  const visitDur = useAppStore((s) => s.visitDur);
  const setVisitDur = useAppStore((s) => s.setVisitDur);
  const setToggle = useAppStore((s) => s.setToggle);
  const scopeOn = useAppStore((s) => s.toggles.scopeOn);
  const openModal = useOpenModal();

  const [chkNew, setChkNew] = useState("");

  function handleAddChecklist() {
    const name = chkNew.trim();
    if (!name) return;
    addChecklist(name, "scope");
    setChkNew("");
  }

  return (
    <>
      <FoldCard title="Visit checklists" summary={`${scopeChecklists.length} lists`}>
        <div className="stage-row" style={{ borderTop: "none", marginTop: 0 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700 }}>Visit checks</b>
            <div className="muted" style={{ fontSize: 12 }}>
              A per-job-type checklist on the site visit; flags what&apos;s missing before you quote.
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={scopeOn} onChange={(e) => setToggle("scopeOn", e.target.checked)} />
            <i />
          </label>
        </div>
        {scopeChecklists.map((c) => {
          const requiredCount = c.items.filter((i) => i.required).length;
          return (
            <div key={c.id} className="stage-row">
              <span style={{ fontWeight: 700 }}>{c.name}</span>
              <span className="trig">{c.trade} · {c.items.length} items · {requiredCount} required</span>
              <button className="btn sm" onClick={() => openModal(MODAL.STANDARDS)}>Edit</button>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" id="chkNew" placeholder="job type — e.g. Sump pump" value={chkNew} onChange={(e) => setChkNew(e.target.value)}
            style={{ flex: 1, minWidth: 140, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddChecklist}>+ Create blank</button>
          {/* deferred: SOP paste import */}
          <span className="linklike" style={{ fontSize: 12 }} onClick={() => {}}>paste an SOP</span>
        </div>
      </FoldCard>

      <FoldCard
        title="Visit lengths"
        summary={`${Math.round(visitDur.scope * 60)} · ${Math.round(visitDur.repair * 60)} · ${Math.round(visitDur.install * 60)} min`}
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
                  defaultValue={Math.round(visitDur[k] * 60)}
                  onChange={(e) => setVisitDur(k, Number(e.target.value))}
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
  const trade = useAppStore((s) => s.trade);
  const setTrade = useAppStore((s) => s.setTrade);
  const laborRates = useAppStore((s) => s.laborRates);
  const addLaborRate = useAppStore((s) => s.addLaborRate);
  const updateLaborRate = useAppStore((s) => s.updateLaborRate);
  const removeLaborRate = useAppStore((s) => s.removeLaborRate);
  const pricebook = useAppStore((s) => s.pricebook);
  const addPricebookItem = useAppStore((s) => s.addPricebookItem);
  const updatePricebookItem = useAppStore((s) => s.updatePricebookItem);
  const removePricebookItem = useAppStore((s) => s.removePricebookItem);
  const markup = useAppStore((s) => s.markup);
  const setMarkup = useAppStore((s) => s.setMarkup);
  const terms = useAppStore((s) => s.terms);
  const addTerm = useAppStore((s) => s.addTerm);
  const removeTerm = useAppStore((s) => s.removeTerm);

  const [lrName, setLrName] = useState("");
  const [lrRate, setLrRate] = useState("");
  const [pbName, setPbName] = useState("");
  const [pbRate, setPbRate] = useState("");
  const [pbCost, setPbCost] = useState("");
  const [tlName, setTlName] = useState("");
  const [tlBody, setTlBody] = useState("");

  function handleAddLabor() {
    addLaborRate(lrName, Number(lrRate));
    setLrName("");
    setLrRate("");
  }

  function handleAddPb() {
    addPricebookItem(pbName, Number(pbRate), Number(pbCost));
    setPbName("");
    setPbRate("");
    setPbCost("");
  }

  function handleAddTerm() {
    addTerm(tlName, tlBody);
    setTlName("");
    setTlBody("");
  }

  return (
    <>
      <FoldCard title="Your trade" summary={cap(trade)}>
        <select
          id="setTrade"
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
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

      <FoldCard title="Labor rates" defaultOpen summary={`${laborRates.length} rate${laborRates.length === 1 ? "" : "s"}`}>
        <div>
          {laborRates.map((lr) => (
            <div key={lr.id} className="stage-row">
              <input type="text" defaultValue={lr.name}
                onChange={(e) => updateLaborRate(lr.id, "name", e.target.value)}
                style={{ flex: 1, minWidth: 120, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input type="number" defaultValue={lr.rate}
                  onChange={(e) => updateLaborRate(lr.id, "rate", e.target.value)}
                  style={{ width: 80, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
                <span className="muted" style={{ fontSize: 12 }}>/hr</span>
              </span>
              {laborRates.length > 1 && (
                <button className="btn sm ghost" onClick={() => removeLaborRate(lr.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="lrName" placeholder="e.g. Apprentice, Weekend" value={lrName} onChange={(e) => setLrName(e.target.value)}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="lrRate" placeholder="$/hr" value={lrRate} onChange={(e) => setLrRate(e.target.value)}
            style={{ flex: "0 0 100px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddLabor}>+ Add</button>
        </div>
      </FoldCard>

      <FoldCard title="Pricebook" summary={`${pricebook.length} lines`}>
        <div>
          {pricebook.map((p) => (
            <div key={p.id} className="stage-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input type="text" defaultValue={p.label}
                onChange={(e) => updatePricebookItem(p.id, "label", e.target.value)}
                style={{ flex: 1, minWidth: 150, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input type="number" defaultValue={p.unitPrice}
                  onChange={(e) => updatePricebookItem(p.id, "unitPrice", e.target.value)}
                  style={{ width: 78, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted" style={{ fontSize: 11 }}>cost</span>
                <input type="number" defaultValue={p.cost}
                  onChange={(e) => updatePricebookItem(p.id, "cost", e.target.value)}
                  style={{ width: 64, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
              </span>
              <span className="muted" style={{ fontSize: "11.5px", minWidth: 62, textAlign: "right" }}>
                {p.cost ? `${pbMarginPct(p)}% margin` : ""}
              </span>
              <button className="btn sm ghost" onClick={() => removePricebookItem(p.id)}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="pbName" placeholder="e.g. Sewer camera inspection" value={pbName} onChange={(e) => setPbName(e.target.value)}
            style={{ flex: 2, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="pbRate" placeholder="price $" value={pbRate} onChange={(e) => setPbRate(e.target.value)}
            style={{ flex: "0 0 92px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="number" id="pbCost" placeholder="cost $" value={pbCost} onChange={(e) => setPbCost(e.target.value)}
            style={{ flex: "0 0 92px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddPb}>+ Add</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {/* deferred: pricebook import */}
          <button className="btn ghost sm" onClick={() => {}}>Upload price book</button>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Enter a cost and the price pre-fills at your default markup. Techs never see cost or margin.
        </p>
      </FoldCard>

      <FoldCard title="Default parts markup" summary={`${markup}%`}>
        <div className="field" style={{ maxWidth: 200, margin: 0 }}>
          <label>Markup on new parts (%)</label>
          <input type="number" defaultValue={markup} onChange={(e) => setMarkup(Number(e.target.value))} />
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Only pre-fills the suggested price — each pricebook line keeps its own margin.
        </p>
      </FoldCard>

      <FoldCard title="Terms library" summary={`${terms.length} terms`}>
        <div>
          {terms.map((t) => (
            <div key={t.id} className="stage-row">
              <span style={{ fontWeight: 700 }}>{t.t}</span>
              <span className="trig" style={{ maxWidth: 280, whiteSpace: "normal" }}>{t.body.slice(0, 60)}…</span>
              <button className="btn sm ghost" onClick={() => removeTerm(t.id)}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="tlName" placeholder="name (e.g. Repipe terms)" value={tlName} onChange={(e) => setTlName(e.target.value)}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <input type="text" id="tlBody" placeholder="the fine print…" value={tlBody} onChange={(e) => setTlBody(e.target.value)}
            style={{ flex: 2, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddTerm}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Booking
// ============================================================================

function SecBooking() {
  const bk = useAppStore((s) => s.booking);
  const updateBookingService = useAppStore((s) => s.updateBookingService);
  const addBookingService = useAppStore((s) => s.addBookingService);
  const removeBookingService = useAppStore((s) => s.removeBookingService);
  const setServiceFee = useAppStore((s) => s.setServiceFee);
  const setFeeCredited = useAppStore((s) => s.setFeeCredited);
  const setBookingField = useAppStore((s) => s.setBookingField);
  const setBookingHours = useAppStore((s) => s.setBookingHours);
  const setBookingArea = useAppStore((s) => s.setBookingArea);

  const [bkSvc, setBkSvc] = useState("");

  function handleAddService() {
    addBookingService(bkSvc);
    setBkSvc("");
  }

  const wdLabel = `${timeLabel(bk.hours.wdOpen)}–${timeLabel(bk.hours.wdClose)} wkdays`;

  type HoursKey = keyof typeof bk.hours;

  function HrRow({ lbl, oKey, cKey }: { lbl: string; oKey: HoursKey; cKey: HoursKey }) {
    const ov = bk.hours[oKey];
    const cv = bk.hours[cKey];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
        <span style={{ minWidth: 84, fontWeight: 600, fontSize: "12.5px" }}>{lbl}</span>
        <input type="number" min={0} max={23} defaultValue={ov}
          onChange={(e) => setBookingHours(oKey, Number(e.target.value))}
          style={{ width: 58, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
        <span className="muted">to</span>
        <input type="number" min={0} max={24} defaultValue={cv}
          onChange={(e) => setBookingHours(cKey, Number(e.target.value))}
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
                onChange={(e) => updateBookingService(i, "name", e.target.value)}
                style={{ flex: 1, minWidth: 130, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
              <select defaultValue={s.lane}
                onChange={(e) => updateBookingService(i, "lane", e.target.value)}
                style={{ border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }}>
                <option value="repair">Job — diagnose &amp; price on site</option>
                <option value="estimate">Estimate visit — scope it, then quote</option>
                <option value="flat">Job — flat price on the call</option>
              </select>
              {s.lane === "flat" && (
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span className="muted">$</span>
                  <input type="number" min={0} defaultValue={s.price ?? 0}
                    onChange={(e) => updateBookingService(i, "price", e.target.value)}
                    style={{ width: 64, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
                </span>
              )}
              <button className="btn sm ghost" onClick={() => removeBookingService(i)}>✕</button>
              <input type="text" defaultValue={s.triggers}
                onChange={(e) => updateBookingService(i, "triggers", e.target.value)}
                placeholder="trigger words — e.g. leaking, no hot water"
                style={{ flexBasis: "100%", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input type="text" id="bkSvc" placeholder="add a service — e.g. Tankless install" value={bkSvc} onChange={(e) => setBkSvc(e.target.value)}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={handleAddService}>+ Add</button>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>We don&apos;t do</label>
          <input type="text" defaultValue={bk.notServices}
            onChange={(e) => setBookingField("notServices", e.target.value)}
            placeholder="e.g. new construction, septic"
            style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
        </div>
      </FoldCard>

      <FoldCard title="Service-call fee" summary={`$${bk.serviceFee}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="muted">$</span>
          <input type="number" min={0} defaultValue={bk.serviceFee}
            onChange={(e) => setServiceFee(Number(e.target.value))}
            style={{ width: 80, border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          <span className="muted" style={{ fontSize: 12 }}>to come diagnose a repair</span>
        </div>
        <div className="stage-row" style={{ marginTop: 10 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 700, fontSize: "13.5px" }}>Credited toward the work</b>
            <div className="muted" style={{ fontSize: "11.5px" }}>Comes off the price if they approve the repair.</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={bk.feeCredited}
              onChange={(e) => setFeeCredited(e.target.checked)} />
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
              onChange={(e) => setBookingArea("cities", e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontFamily: "inherit", fontSize: 13 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Radius (mi)</label>
            <input type="number" min={0} defaultValue={bk.area.radiusMi}
              onChange={(e) => setBookingArea("radiusMi", e.target.value)}
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
          {/* deferred: custom fields */}
          <button className="btn" onClick={() => {}}>+ Add</button>
        </div>
      </FoldCard>

      <FoldCard title="Company custom fields" summary="0">
        <div className="empty-att">
          None yet — add one here, or from any company&apos;s Details.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input type="text" id="setCoCfName" placeholder="e.g. Account number, Region"
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          {/* deferred: custom fields */}
          <button className="btn" onClick={() => {}}>+ Add</button>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Archive
// ============================================================================

function SecArchive() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const archLeads = leads.filter((l) => l.archived);
  const archEsts = estimates.filter((e) => e.archived);
  const restoreLead = useAppStore((s) => s.restoreLead);
  const restoreEstimate = useAppStore((s) => s.restoreEstimate);

  const count = archLeads.length + archEsts.length;

  return (
    <FoldCard
      title="Archive"
      defaultOpen
      summary={count ? `${count} item${count === 1 ? "" : "s"}` : "empty"}
    >
      {archLeads.map((l) => (
        <div key={l.id} className="stage-row">
          <span style={{ fontWeight: 700 }}>{l.name}</span>
          <span className="trig">lead · {l.job} · {l.source}</span>
          <button className="btn sm" onClick={() => restoreLead(l.id)}>↩ Restore</button>
        </div>
      ))}
      {archEsts.map((e) => (
        <div key={e.id} className="stage-row">
          <span style={{ fontWeight: 700 }}>{e.num} — {e.title}</span>
          <span className="trig">quote · {e.status}</span>
          <button className="btn sm" onClick={() => restoreEstimate(e.id)}>↩ Restore</button>
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
  const { data: me } = api.v1.identity.me.useQuery();
  const role = me?.role ?? "office";

  const allSections = [
    { k: "workspace" as SetTab, label: "Workspace",         body: <SecWorkspace role={role} /> },
    { k: "sources"   as SetTab, label: "Lead sources",      body: <SecSources /> },
    { k: "pipeline"  as SetTab, label: "Pipeline",          body: <SecPipeline /> },
    { k: "pricing"   as SetTab, label: "Pricing & quotes", ownerOnly: true, body: <SecPricing /> },
    { k: "booking"   as SetTab, label: "Booking",           ownerOnly: true, body: <SecBooking /> },
    { k: "fields"    as SetTab, label: "Custom fields",     body: <SecFields /> },
    { k: "archive"   as SetTab, label: "Archive",           body: <SecArchive /> },
  ] satisfies SectionDef[];
  const sections: SectionDef[] = allSections.filter((s) => role === "owner" || role === "office" || !s.ownerOnly);

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
