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

import { useState, useEffect } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import type { LaborRateKind } from "@/lib/store/slices/settings-slice";
import { BrandingCard } from "./branding-card";
import { WebsiteFormCard } from "./website-form-card";
import { LeadMarketplacesCard } from "./lead-marketplaces-card";
import { PaymentsCard } from "./payments-card";
import { PricebookCard } from "./pricebook-card";
import { EstimatorMemoryCard } from "./estimator-memory-card";
import { CrewHoursCard } from "./crew-hours-card";
import { IconWell } from "./icon-well";
import { DEFAULT_SOURCES } from "@/lib/store/default-sources";
import { FoldCard } from "./fold-card";
import { ServiceRow } from "./booking-service-card";
import { AddServiceModal, type NewServiceInput } from "./add-service-modal";
import { StarterPlaybookModal } from "./starter-playbook-modal";
import { playbookFor } from "./trade-playbooks";
import { TagInput } from "./tag-input";
import { HourSelect } from "./hour-select";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { normCert } from "@mallet/shared/dispatch/skill-gate";

// ---- sample state values mirrored from prototype's state -------------------

const MALLET_NUMBER = "(925) 555-0100";

// ---- helpers ----------------------------------------------------------------

function cap(s: string): string {
  return s ? (s[0] ?? "").toUpperCase() + s.slice(1) : "";
}

function callRulesSummary(notServices: string, deferKeywords: string): string {
  const count = [notServices, deferKeywords]
    .flatMap((v) => v.split(/[,·]/))
    .map((t) => t.trim())
    .filter(Boolean).length;
  return `${count} rule${count === 1 ? "" : "s"}`;
}

function timeLabel(h: number): string {
  if (!h) return "closed";
  const period = h < 12 ? "a" : "p";
  const dh = h > 12 ? h - 12 : h;
  return `${dh}${period}`;
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
  skillTags: string[];
};

const CERT_MAX = 10;

// Inline cert chips editor — only renders for field-crew members.
// Add/remove saves immediately via setMemberSkillTags. Cap: 10 tags.
function CertChipsEditor({ memberId, skillTags }: { memberId: string; skillTags: string[] }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const setSkillTags = api.v1.identity.setMemberSkillTags.useMutation({
    onSuccess: () => {
      setSaveError(null);
      utils.v1.identity.members.invalidate().catch(() => {});
    },
    onError: (err) => {
      setSaveError(err.message);
    },
  });

  function save(next: string[]): void {
    setSaveError(null);
    setSkillTags.mutate({ userId: memberId, skillTags: next });
  }

  function handleAdd(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (skillTags.length >= CERT_MAX) return;
    // Dedupe case-insensitively via normCert — don't add if already present.
    if (skillTags.some((t) => normCert(t) === normCert(trimmed))) {
      setDraft("");
      return;
    }
    setDraft("");
    save([...skillTags, trimmed]);
  }

  function handleRemove(idx: number): void {
    save(skillTags.filter((_, i) => i !== idx));
  }

  const atCap = skillTags.length >= CERT_MAX;

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>
        Certifications
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: skillTags.length > 0 ? 8 : 0 }}>
        {skillTags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 600,
              padding: "3px 5px 3px 10px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--manila, var(--bg))",
              color: "var(--ink)",
              whiteSpace: "nowrap",
            }}
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              disabled={setSkillTags.isPending}
              onClick={() => handleRemove(i)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-3)",
                fontSize: 12,
                lineHeight: 1,
                padding: "2px 4px",
                fontFamily: "inherit",
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={draft}
          placeholder={atCap ? "10 max" : "Add certification"}
          disabled={atCap || setSkillTags.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          style={{
            flex: "0 0 160px",
            border: "1.5px solid var(--line)",
            borderRadius: 8,
            padding: "6px 8px",
            fontFamily: "inherit",
            fontSize: 13,
            background: atCap ? "var(--bg)" : "var(--card)",
          }}
        />
        <button
          className="btn sm ghost"
          type="button"
          disabled={atCap || !draft.trim() || setSkillTags.isPending}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
      {saveError && (
        <div style={{ color: "var(--red-700)", fontSize: 12, marginTop: 4 }}>{saveError}</div>
      )}
    </div>
  );
}

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
      {member.isFieldCrew && (
        <CertChipsEditor memberId={member.id} skillTags={member.skillTags} />
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
  const [srcError, setSrcError] = useState<string | null>(null);

  async function handleAddSource() {
    const result = await addSource(srcName);
    if (result.ok) {
      setSrcName("");
      setSrcError(null);
    } else if (result.reason === "duplicate") {
      setSrcError("That source is already in your list.");
    } else if (result.reason === "failed") {
      setSrcError("Couldn’t add that source — check your connection and try again.");
    } else {
      setSrcError(null); // empty input — no-op, no error needed
    }
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
        <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
          <IconWell>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </IconWell>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="muted" style={{ fontSize: 13, margin: "1px 0 11px", lineHeight: 1.45 }}>
              Bring your existing customers over from QuickBooks, Google Contacts, Jobber, or any spreadsheet — export a CSV and upload it.
            </p>
            <button className="btn primary" onClick={() => openModal(MODAL.IMPORT_CUSTOMERS)}>
              Upload a spreadsheet (CSV)
            </button>
          </div>
        </div>
      </FoldCard>

      <WebsiteFormCard />

      <FoldCard title="Source list" summary={`${DEFAULT_SOURCES.length + sources.length} sources`}>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
          Where your leads come from — tag each lead with one. Built-in sources are always available; add your own below.
        </p>
        <div>
          {DEFAULT_SOURCES.map((label) => {
            const n = leads.filter((l) => l.source === label).length;
            return (
              <div key={label} className="stage-row">
                <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
                <span className="muted" style={{ fontSize: 12, minWidth: 62, textAlign: "right" }}>{n} lead{n === 1 ? "" : "s"}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", background: "var(--manila)", border: "1px solid var(--manila-line)", borderRadius: 999, padding: "2px 8px" }}>
                  Built-in
                </span>
              </div>
            );
          })}
          {sources.map((s) => {
            const n = leads.filter((l) => l.source === s.label).length;
            return (
              <div key={s.id} className="stage-row">
                <span style={{ fontWeight: 700, flex: 1 }}>{s.label}</span>
                <span className="muted" style={{ fontSize: 12, minWidth: 62, textAlign: "right" }}>{n} lead{n === 1 ? "" : "s"}</span>
                <button className="btn sm ghost" aria-label={`Remove ${s.label}`} onClick={() => removeSource(s.id)}>✕</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <input type="text" id="setSrcName" placeholder="Add a source — e.g. Home show, Truck wrap" value={srcName}
            onChange={(e) => { setSrcName(e.target.value); if (srcError) setSrcError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddSource(); }}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
          <button className="btn" onClick={() => void handleAddSource()}>+ Add</button>
        </div>
        {srcError && (
          <p style={{ color: "var(--red)", fontSize: 12, margin: "8px 0 0" }}>{srcError}</p>
        )}
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Pricing & quotes
// ============================================================================

function SecPricing() {
  const laborRates = useAppStore((s) => s.laborRates);
  const addLaborRate = useAppStore((s) => s.addLaborRate);
  const updateLaborRate = useAppStore((s) => s.updateLaborRate);
  const removeLaborRate = useAppStore((s) => s.removeLaborRate);
  const markup = useAppStore((s) => s.markup);
  const setMarkup = useAppStore((s) => s.setMarkup);
  const terms = useAppStore((s) => s.terms);
  const addTerm = useAppStore((s) => s.addTerm);
  const removeTerm = useAppStore((s) => s.removeTerm);

  const [lrName, setLrName] = useState("");
  const [lrRate, setLrRate] = useState("");
  const [lrKind, setLrKind] = useState<LaborRateKind>("hourly");
  const [tlName, setTlName] = useState("");
  const [tlBody, setTlBody] = useState("");

  function handleAddLabor() {
    addLaborRate(lrName, Number(lrRate), lrKind);
    setLrName("");
    setLrRate("");
    setLrKind("hourly");
  }

  function handleAddTerm() {
    addTerm(tlName, tlBody);
    setTlName("");
    setTlBody("");
  }

  return (
    <>
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
                <select
                  aria-label={`Unit for ${lr.name}`}
                  value={lr.kind}
                  onChange={(e) => updateLaborRate(lr.id, "kind", e.target.value)}
                  style={{ border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 6px", fontFamily: "inherit", fontSize: 12, color: "var(--ink-2)", background: "var(--card)" }}
                >
                  <option value="hourly">/hr</option>
                  <option value="flat_fee">flat</option>
                </select>
              </span>
              {laborRates.length > 1 && (
                <button className="btn sm ghost" onClick={() => removeLaborRate(lr.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="chips" style={{ marginBottom: 8 }}>
            <button type="button" className={`chip${lrKind === "hourly" ? " sel" : ""}`} onClick={() => setLrKind("hourly")}>
              Hourly
            </button>
            <button type="button" className={`chip${lrKind === "flat_fee" ? " sel" : ""}`} onClick={() => setLrKind("flat_fee")}>
              Flat fee
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" id="lrName" placeholder="e.g. Diagnostic fee, After-hours" value={lrName} onChange={(e) => setLrName(e.target.value)}
              style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
            <input type="number" id="lrRate" placeholder={lrKind === "flat_fee" ? "$" : "$/hr"} value={lrRate} onChange={(e) => setLrRate(e.target.value)}
              style={{ flex: "0 0 100px", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
            <button className="btn" onClick={handleAddLabor}>+ Add</button>
          </div>
        </div>
      </FoldCard>

      <PricebookCard />

      <EstimatorMemoryCard />

      <FoldCard title="Default parts markup" summary={`${markup}%`}>
        <div className="field" style={{ maxWidth: 200, margin: 0 }}>
          <label>Markup on new parts (%)</label>
          <input type="number" defaultValue={markup} onChange={(e) => setMarkup(Number(e.target.value))} />
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: "11.5px" }}>
          Applied to found-work / T&amp;M parts a tech adds on site — each pricebook line keeps its own price.
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

  // Single-expanded service accordion — null = all collapsed
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const seedBookingServices = useAppStore((st) => st.seedBookingServices);
  const setTrade = useAppStore((st) => st.setTrade);

  function handleSeedTrade(tradeKey: string) {
    const playbook = playbookFor(tradeKey);
    if (!playbook) return;
    seedBookingServices(playbook.services);
    if (tradeKey !== "other") setTrade(playbook.label);
  }

  // Modal-driven add: create the named service, then fill lane/price/description on the new
  // index (append order is stable — addBookingService pushes to the end).
  function handleAddService(svc: NewServiceInput) {
    const newIdx = bk.services.length;
    addBookingService(svc.name);
    updateBookingService(newIdx, "lane", svc.lane);
    if (svc.lane === "flat" && svc.price !== "") updateBookingService(newIdx, "price", svc.price);
    if (svc.triggers.trim()) updateBookingService(newIdx, "triggers", svc.triggers.trim());
  }

  function handleToggleService(i: number) {
    setExpandedIdx((prev) => (prev === i ? null : i));
  }

  function handleRemoveService(i: number) {
    removeBookingService(i);
    // If we just removed the expanded one, collapse
    setExpandedIdx((prev) => (prev === i ? null : prev !== null && prev > i ? prev - 1 : prev));
  }

  const wdLabel = `${timeLabel(bk.hours.wdOpen)}–${timeLabel(bk.hours.wdClose)} wkdays`;

  type HoursKey = keyof typeof bk.hours;

  function HrRow({ lbl, oKey, cKey }: { lbl: string; oKey: HoursKey; cKey: HoursKey }) {
    const ov = bk.hours[oKey];
    const cv = bk.hours[cKey];
    const isOpen = !(ov === 0 && cv === 0);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
        <span style={{ minWidth: 84, fontWeight: 700, fontSize: 13.5 }}>{lbl}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={isOpen}
            onChange={(e) => {
              if (e.target.checked) {
                setBookingHours(oKey, 8);
                setBookingHours(cKey, 17);
              } else {
                setBookingHours(oKey, 0);
                setBookingHours(cKey, 0);
              }
            }}
          />
          <i />
        </label>
        {isOpen ? (
          <>
            <HourSelect
              value={ov}
              onChange={(h) => {
                setBookingHours(oKey, h);
                // Keep the range valid: close stays after open (an inverted range reads as a
                // closed day to the slot math, silently killing that day's availability).
                if (h >= cv) setBookingHours(cKey, Math.min(h + 1, 24));
              }}
              min={0}
              max={23}
            />
            <span className="muted">to</span>
            <HourSelect
              value={cv}
              onChange={(h) => setBookingHours(cKey, h)}
              min={ov + 1}
              max={24}
            />
          </>
        ) : (
          <span className="muted" style={{ fontSize: "11.5px" }}>Closed</span>
        )}
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
          <button className="btn ghost" onClick={() => setStarterOpen(true)}>Starter playbook</button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>+ Add service</button>
        </div>
        {/* List-first accordion: compact rows, single expanded editor */}
        <div style={{ border: "1px solid var(--line-2, var(--line))", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
          {bk.services.map((s, i) => (
            <ServiceRow
              key={i}
              service={s}
              index={i}
              isExpanded={expandedIdx === i}
              onToggle={() => handleToggleService(i)}
              updateBookingService={updateBookingService}
              onRemove={() => handleRemoveService(i)}
              isLast={i === bk.services.length - 1}
            />
          ))}
          {bk.services.length === 0 && (
            <div style={{ padding: "22px 14px", textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                Pick your trade to load starter services
              </div>
              <button className="btn primary" onClick={() => setStarterOpen(true)}>
                Choose trade
              </button>
            </div>
          )}
        </div>
        <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddService} />
        <StarterPlaybookModal open={starterOpen} onClose={() => setStarterOpen(false)} onSeed={handleSeedTrade} />
      </FoldCard>

      <FoldCard title="Call rules" summary={callRulesSummary(bk.notServices, bk.deferKeywords ?? "")}>
        <div className="field">
          <label>We don&apos;t do</label>
          <TagInput
            value={bk.notServices}
            onChange={(v) => setBookingField("notServices", v)}
            placeholder="Type a service and press Enter — e.g. new construction"
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Hand off to a person</label>
          <TagInput
            value={bk.deferKeywords ?? ""}
            onChange={(v) => setBookingField("deferKeywords", v)}
            placeholder="Type a word and press Enter — e.g. insurance, claim, warranty"
          />
        </div>
      </FoldCard>

      <FoldCard title="Service-call fee" summary={`$${bk.serviceFee}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="muted">$</span>
          <input type="number" min={0} defaultValue={bk.serviceFee}
            onChange={(e) => setServiceFee(Number(e.target.value))}
            style={{ width: 110, border: "1.5px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, background: "var(--card)" }} />
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
        <div style={{fontSize:11, textTransform:"uppercase", letterSpacing:".04em", margin:"2px 0 8px"}} className="muted">Business hours</div>
        <div>
          <HrRow lbl="Weekdays" oKey="wdOpen" cKey="wdClose" />
          <HrRow lbl="Saturday" oKey="satOpen" cKey="satClose" />
          <HrRow lbl="Sunday"   oKey="sunOpen" cKey="sunClose" />
        </div>
        <div style={{fontSize:11, textTransform:"uppercase", letterSpacing:".04em", margin:"14px 0 8px"}} className="muted">Service area</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, maxWidth: 640 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Office address</label>
            <input type="text" defaultValue={bk.area.originAddress}
              onChange={(e) => setBookingArea("originAddress", e.target.value)}
              placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
              style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8 }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Radius (miles)</label>
            <input type="number" min={0} defaultValue={bk.area.radiusMi}
              onChange={(e) => setBookingArea("radiusMi", e.target.value)}
              style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8 }} />
          </div>
        </div>
      </FoldCard>

      <CrewHoursCard />
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

type SetTab = "workspace" | "sources" | "pricing" | "payments" | "booking" | "fields" | "archive";

interface SectionDef {
  k: SetTab;
  label: string;
  ownerOnly?: boolean;
  body: React.ReactNode;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SetTab>("workspace");
  // Deep-link support (/settings?tab=booking) — read once on mount; avoids the
  // useSearchParams/Suspense requirement and any SSR hydration mismatch.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["workspace", "sources", "pricing", "payments", "booking", "fields", "archive"].includes(t)) {
      setActiveTab(t as SetTab);
    }
  }, []);
  const { data: me } = api.v1.identity.me.useQuery();
  const role = me?.role ?? "office";

  const allSections = [
    { k: "workspace" as SetTab, label: "Workspace",         body: <SecWorkspace role={role} /> },
    { k: "sources"   as SetTab, label: "Lead sources",      body: <SecSources /> },
    { k: "pricing"   as SetTab, label: "Pricing & quotes", ownerOnly: true, body: <SecPricing /> },
    { k: "payments"  as SetTab, label: "Payments",          ownerOnly: true, body: <PaymentsCard /> },
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
