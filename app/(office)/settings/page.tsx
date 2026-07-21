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
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { BrandingCard } from "./branding-card";
import { WebsiteFormCard } from "./website-form-card";
import { LeadMarketplacesCard } from "./lead-marketplaces-card";
import { PaymentsCard } from "./payments-card";
import { CrewHoursCard } from "./crew-hours-card";
import { DEFAULT_SOURCES } from "@/lib/store/default-sources";
import { FoldCard } from "./fold-card";
import { api } from "@/lib/trpc/client";
import { normCert } from "@mallet/shared/dispatch/skill-gate";

// ---- sample state values mirrored from prototype's state -------------------


// ---- helpers ----------------------------------------------------------------

function cap(s: string): string {
  return s ? (s[0] ?? "").toUpperCase() + s.slice(1) : "";
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
          <h3 className="setgrp" style={{ margin: "var(--space-5) 0 var(--space-3)" }}>
            Your account
          </h3>
          <YourNameField />
        </>
      )}
    </>
  );
}

// ============================================================================
// Section: Team — people, roles, permissions, and when each crew member works.
// Crew hours moved here from Booking (settings-IA regroup): a person's identity
// and their working hours belong together — the Front Desk playbook reads the
// same crew_schedules data either way.
// ============================================================================

function SecTeam() {
  return (
    <>
      <TeamRolesBlock />
      <CrewHoursCard />
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
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginBottom: "var(--space-2)" }}>
        Shown in greetings and on the dispatch board. Your login email stays unchanged.
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="e.g. Mike Rivera"
          value={displayName}
          onChange={(e) => { setName(e.target.value); setSaved(false); setSaveError(null); }}
          style={{ flex: 1, minWidth: 180, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)" }}
        />
        <button
          className="btn primary"
          disabled={updateMe.isPending || !displayName.trim()}
          onClick={handleSave}
        >
          {updateMe.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ color: "var(--green-900)", fontSize: "var(--type-sm)", fontWeight: 600 }}>Saved ✓</span>}
      </div>
      {saveError && (
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{saveError}</div>
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
    <div style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--line)" }}>
      <div style={{ fontSize: "var(--type-xs)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700, color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
        Certifications
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", marginBottom: skillTags.length > 0 ? 8 : 0 }}>
        {skillTags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              fontSize: "var(--type-base)",
              fontWeight: 600,
              padding: "var(--space-1) var(--space-1) var(--space-1) var(--space-3)",
              borderRadius: "var(--radius-xl)",
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
                fontSize: "var(--type-sm)",
                lineHeight: 1,
                padding: "var(--space-2xs) var(--space-1)",
                fontFamily: "inherit",
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
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
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-2)",
            fontFamily: "inherit",
            fontSize: "var(--type-base)",
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
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>{saveError}</div>
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
    <div className="stage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--space-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontWeight: 700 }}>{member.name ?? member.email}</b>
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)" }}>
            {member.email}
          </div>
        </div>
        <select
          className="tsel"
          aria-label={`Role for ${member.name ?? member.email}`}
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
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", paddingLeft: "var(--space-2xs)" }}>{roleError}</div>
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
        <span style={{ color: "var(--green-900)", fontSize: "var(--type-sm)", fontWeight: 600 }}>
          Invite email sent ✓
        </span>
      );
    }
    if (inviteStatus.kind === "no_email") {
      return (
        <span style={{ color: "var(--amber-700, #b45309)", fontSize: "var(--type-sm)", fontWeight: 600 }}>
          Invite created — ask them to sign up with this email
        </span>
      );
    }
    return null;
  }

  return (
    <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder="teammate@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setInviteError(null); setInviteStatus({ kind: "idle" }); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
          style={{ flex: 1, minWidth: 180, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)" }}
        />
        <select
          className="tsel"
          aria-label="Role for the new teammate"
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
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{inviteError}</div>
      )}
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
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
    <div className="stage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--space-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>{invite.email}</span>
          <span className="muted" style={{ fontSize: "var(--type-sm)", marginLeft: "var(--space-2)" }}>{cap(invite.role)} · pending</span>
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
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", paddingLeft: "var(--space-2xs)" }}>{revokeError}</div>
      )}
    </div>
  );
}

function PendingInvitesList() {
  const { data, isLoading } = api.v1.identity.listInvites.useQuery();

  if (isLoading) {
    return <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-1) 0" }}>Loading invites…</div>;
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-2) 0" }}>
        No pending invites.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "var(--space-1)" }}>
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
          <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-2) 0" }}>Loading members…</div>
        )}
        {isError && (
          <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-2) 0" }}>Could not load members.</div>
        )}
        {data?.items.map((member) => (
          <MemberRow key={member.id} member={member} />
        ))}
        <InviteForm />
        <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
          <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, marginBottom: "var(--space-1)" }}>Pending invites</div>
          <PendingInvitesList />
        </div>
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          The toggle makes a member schedulable on the dispatch board ({fieldCrewCount} on now).
        </div>
      </FoldCard>

      <FoldCard title="Sensitive data" summary="permissions">
        <div className="stage-row" style={{ borderTop: "none", marginTop: "0" }}>
          <div style={{ flex: 1 }}>
            <b>Techs can see job prices</b>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>The job total only — your cost and margin stay office-only.</div>
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

function SecChannels() {
  const sources = useAppStore((s) => s.sources);
  const leads = useAppStore((s) => s.leads);
  const addSource = useAppStore((s) => s.addSource);
  const removeSource = useAppStore((s) => s.removeSource);

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
      <LeadMarketplacesCard />

      <WebsiteFormCard />

      <FoldCard title="Source list" summary={`${DEFAULT_SOURCES.length + sources.length} sources`}>
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-1)" }}>
          Where your leads come from — tag each lead with one. Built-in sources are always available; add your own below.
        </p>
        <div>
          {DEFAULT_SOURCES.map((label) => {
            const n = leads.filter((l) => l.source === label).length;
            return (
              <div key={label} className="stage-row">
                <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
                <span className="muted" style={{ fontSize: "var(--type-sm)", minWidth: 62, textAlign: "right" }}>{n} lead{n === 1 ? "" : "s"}</span>
                <span style={{ fontSize: "var(--type-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)", background: "var(--manila)", border: "1px solid var(--manila-line)", borderRadius: "var(--radius-xl)", padding: "var(--space-2xs) var(--space-2)" }}>
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
                <span className="muted" style={{ fontSize: "var(--type-sm)", minWidth: 62, textAlign: "right" }}>{n} lead{n === 1 ? "" : "s"}</span>
                <button className="btn sm ghost" aria-label={`Remove ${s.label}`} onClick={() => removeSource(s.id)}>✕</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
          <input type="text" id="setSrcName" placeholder="Add a source — e.g. Home show, Truck wrap" value={srcName}
            onChange={(e) => { setSrcName(e.target.value); if (srcError) setSrcError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddSource(); }}
            style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)" }} />
          <button className="btn" onClick={() => void handleAddSource()}>+ Add</button>
        </div>
        {srcError && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{srcError}</p>
        )}
      </FoldCard>
    </>
  );
}
// ============================================================================
// Main page
// ============================================================================

type SetTab = "workspace" | "team" | "channels" | "payments";

// Old deep-link tab names → their new homes (settings-IA regroup). ?tab=payments must keep
// working verbatim — Stripe's Connect onboarding return URL points at it server-side.
const TAB_ALIASES: Record<string, SetTab> = {
  sources: "channels",
  fields: "workspace",
  archive: "workspace",
};

interface SectionDef {
  k: SetTab;
  label: string;
  ownerOnly?: boolean;
  body: React.ReactNode;
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SetTab>("workspace");
  // Deep-link support (/settings?tab=booking) — read once on mount; avoids the
  // useSearchParams/Suspense requirement and any SSR hydration mismatch.
  // ?tab=pricing moved to its own surface (settings-IA decision, Jul 2026) —
  // old links redirect there rather than dead-ending on Workspace.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "pricing") {
      router.replace("/pricebook");
      return;
    }
    // The Front Desk moved to its own Office page — old booking/frontdesk links follow it.
    if (t === "booking" || t === "frontdesk") {
      router.replace("/frontdesk");
      return;
    }
    if (!t) return;
    const canonical: SetTab | undefined = ["workspace", "team", "channels", "payments"].includes(t)
      ? (t as SetTab)
      : TAB_ALIASES[t];
    if (canonical) setActiveTab(canonical);
  }, [router]);
  const { data: me } = api.v1.identity.me.useQuery();
  const role = me?.role ?? "office";

  const allSections = [
    { k: "workspace" as SetTab, label: "Workspace",  body: <SecWorkspace role={role} /> },
    { k: "team"      as SetTab, label: "Team",       body: <SecTeam /> },
    { k: "channels"  as SetTab, label: "Channels",   body: <SecChannels /> },
    { k: "payments"  as SetTab, label: "Payments",   ownerOnly: true, body: <PaymentsCard /> },
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
              onClick={() => {
                setActiveTab(s.k);
                // Keep the URL addressable (shareable / AI-bar linkable) without a
                // navigation — replaceState avoids the useSearchParams/Suspense cost.
                window.history.replaceState(null, "", `/settings?tab=${s.k}`);
              }}
            >
              <span>{s.label}</span>
            </div>
          ))}
        </nav>

        <div className="setbody">
          {/* Only the ACTIVE section mounts — previously every tab rendered behind
              display:none, so all their queries fired on page load. */}
          {sections.find((s) => s.k === tab)?.body}
        </div>
      </div>
    </div>
  );
}
