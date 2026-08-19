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
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { BrandingCard } from "./branding-card";
import { BusinessIdentityCard } from "./business-identity-card";
import { DocumentsCard } from "./documents-card";
import { SalesTaxCard } from "./sales-tax-card";
import { CallbackNumberCard } from "./callback-number-card";
import { A2pRegistrationCard } from "./a2p/a2p-registration-card";
import { MarkYou, MarkTeam, MarkPermissions, MarkPunch } from "./setting-marks";
import { resolveSettingsTab, DEFAULT_SET_TAB, type SetTab } from "./settings-tabs";
import { WebsiteFormCard } from "./website-form-card";
import { LeadMarketplacesCard } from "./lead-marketplaces-card";
import { PaymentsCard } from "./payments-card";
import { TapToPayCard } from "./tap-to-pay-card";
import { QuickbooksCard } from "./quickbooks-card";
import { SquareCard } from "./square-card";
import { CrewHoursCard } from "./crew-hours-card";
import { TimezoneCard } from "./timezone-card";
import { ImportCard } from "./import-card";
import { FoldCard } from "./fold-card";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { CostRateField } from "./cost-rate-field";
import { normCert } from "@mallet/shared/dispatch/skill-gate";
import { SelectMenu } from "@/components/ui/select-menu";
import { userMessage } from "@/lib/trpc/error-map";

// ---- sample state values mirrored from prototype's state -------------------


// ---- helpers ----------------------------------------------------------------

function cap(s: string): string {
  return s ? (s[0] ?? "").toUpperCase() + s.slice(1) : "";
}



// ============================================================================
// Section: Workspace
// ============================================================================

/**
 * A heading INSIDE a tab.
 *
 * The tabs answer "which area of the business"; these answer "which KIND of thing". Without them a
 * tab is one undifferentiated stack of identical rows — which is what makes a settings page feel
 * structureless even when the grouping above it is right.
 */
function SetGroup({ children }: { children: React.ReactNode }) {
  return <h2 className="setgroup">{children}</h2>;
}

/**
 * The COMPANY: who this shop is, what its paperwork says, and how it runs.
 *
 * It was called "Workspace", which named nothing an owner would go looking for — a man hunting for
 * his licence number or his tax rate had no reason to open it. Everything here is one shared value
 * the whole shop sees; anything that differs per person lives under "You".
 */
function SecCompany() {
  return (
    <>
      <SetGroup>Who you are</SetGroup>
      <BrandingCard />
      {/* Directly under Branding: both answer "what does the customer see". Branding is how the
          shop LOOKS on a document, this is who it IS — and the two are edited together the once,
          when a shop sets itself up. */}
      <BusinessIdentityCard />

      <SetGroup>What your paperwork says</SetGroup>
      {/* Directly under Business details: Branding is how the shop looks, Business details is
          who it is, Documents is what its paperwork SAYS — the wording slots on invoices and
          change orders. */}
      <DocumentsCard />
      {/* Next to Business details: both are facts the customer sees on a document, and both
          are set once when a shop is stood up. */}
      <SalesTaxCard />

      <SetGroup>How the shop runs</SetGroup>
      {/* The source list is NOT here any more. It is edited in the picker that uses it — the Lead
          source row of the new-customer modal — which is where a wrong or missing source is
          noticed. A settings page you have to remember to visit is how "Refferal" survives for a
          year. */}
      <TimezoneCard />
    </>
  );
}

// ============================================================================
// Section: You — the only settings that are yours rather than the company's.
// Split out of Workspace because a shared page of company settings with two
// personal fields buried under a heading gave no signal about which was which.
// ============================================================================

function SecYou() {
  return (
    <>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>
        These are yours alone. Everyone else in the shop has their own.
      </p>
      <YourNameField />
      <CallbackNumberCard />
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
      <SetGroup>Your people</SetGroup>
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
  const { saved, flash, reset: resetSaved } = useSaveFlash();
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateMe = api.v1.identity.updateMe.useMutation({
    onSuccess: () => {
      setSaveError(null);
      utils.v1.identity.me.invalidate().catch(() => {});
      utils.v1.identity.members.invalidate().catch(() => {});
      flash();
    },
    onError: (err) => {
      setSaveError(err.message);
    },
  });

  const displayName = name ?? me?.name ?? "";

  function handleSave() {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    resetSaved();
    setSaveError(null);
    updateMe.mutate({ name: trimmed });
  }

  return (
    <FoldCard mark={<MarkYou />} title="Your name" defaultOpen summary={me?.name ?? me?.email ?? ""}>
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginBottom: "var(--space-2)" }}>
        Shown in greetings and on the dispatch board. Your login email stays unchanged.
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="e.g. Mike Rivera"
          value={displayName}
          onChange={(e) => { setName(e.target.value); resetSaved(); setSaveError(null); }}
          style={{ flex: 1, minWidth: 180, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)" }}
        />
        <button
          className="btn primary"
          disabled={updateMe.isPending || !displayName.trim()}
          onClick={handleSave}
        >
          {updateMe.isPending ? "Saving…" : "Save"}
        </button>
        <SavedFlash saved={saved} />
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
  takesCalls: boolean;
  skillTags: string[];
  costRateCents: number | null;
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
              borderRadius: "var(--radius-pill)",
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

  const [callsError, setCallsError] = useState<string | null>(null);
  const setTakesCalls = api.v1.identity.setMemberTakesCalls.useMutation({
    onSuccess: () => void utils.v1.identity.members.invalidate(),
    // The server refuses this for anyone without a verified number, because accepting it would
    // silently do nothing — the on-call reader skips them.
    onError: (e) => setCallsError(userMessage(e)),
  });
  const setFieldCrew = api.v1.identity.setMemberFieldCrew.useMutation({
    onSuccess: () => { utils.v1.identity.members.invalidate().catch(() => {}); },
  });

  const setRole = api.v1.identity.setMemberRole.useMutation({
    onSuccess: () => {
      setRoleError(null);
      utils.v1.identity.members.invalidate().catch(() => {});
    },
    // Never the raw transport message: it printed "cannot remove the last owner" at whoever tried,
    // which is a log line, not an answer. userMessage passes through the sentences a human wrote
    // (the last-owner refusal names the move that clears it) and supplies copy for the rest.
    onError: (err) => {
      setRoleError(userMessage(err, "Couldn't change that role — try again."));
    },
  });

  return (
    <div className="stage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--space-1)" }}>
      <div className="member-row-top" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontWeight: 700 }}>{member.name ?? member.email}</b>
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {member.email}
          </div>
        </div>
        {/* Fixed-basis wrapper so SelectMenu's internal width:100% resolves against
            this box, not the whole row — otherwise its flex-basis becomes the row's
            full width and the dropdown fights the two toggles for space at 393px. */}
        <div style={{ flex: "0 1 128px", minWidth: 0 }}>
          <SelectMenu
            aria-label={`Role for ${member.name ?? member.email}`}
            value={member.role}
            disabled={setRole.isPending}
            onChange={(v) => {
              setRoleError(null);
              setRole.mutate({ userId: member.id, role: v as "owner" | "office" | "tech" });
            }}
            options={[
              { value: "owner", label: "Owner" },
              { value: "office", label: "Office" },
              { value: "tech", label: "Tech" },
            ]}
            compact
          />
        </div>
        <label className="switch" title="Schedulable field crew">
          <input
            type="checkbox"
            checked={member.isFieldCrew}
            disabled={setFieldCrew.isPending}
            onChange={(e) => setFieldCrew.mutate({ userId: member.id, isFieldCrew: e.target.checked })}
          />
          <i />
        </label>
        {/* Whether the front desk may put an urgent caller through to them. WHEN comes from their
            crew hours, so this is only "may they be interrupted at all". */}
        <label className="switch" title="Takes urgent calls from the front desk">
          <input
            type="checkbox"
            checked={member.takesCalls}
            disabled={setTakesCalls.isPending}
            onChange={(e) => {
              setCallsError(null);
              setTakesCalls.mutate({ userId: member.id, takesCalls: e.target.checked });
            }}
          />
          <i />
        </label>
      </div>
      {roleError && (
        <div style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", paddingLeft: "var(--space-2xs)" }}>{roleError}</div>
      )}
      {callsError && (
        <div role="alert" style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", paddingLeft: "var(--space-2xs)" }}>{callsError}</div>
      )}
      {member.isFieldCrew && (
        <>
          <CertChipsEditor memberId={member.id} skillTags={member.skillTags} />
          {/* Field crew only: job costing divides revenue by the hours of whoever ran the visit,
              and only field crew are on visits. An office cost rate would be a number with
              nothing to multiply. */}
          <CostRateField memberId={member.id} costRateCents={member.costRateCents} />
        </>
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
        <SelectMenu
          aria-label="Role for the new teammate"
          value={role}
          onChange={(v) => setRole(v as "owner" | "office" | "tech")}
          options={[
            // Tech first here (not Owner, as in the member rows) — the common invite, and the
            // order the form already used.
            { value: "tech", label: "Tech" },
            { value: "office", label: "Office" },
            { value: "owner", label: "Owner" },
          ]}
          compact
        />
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

// Overtime-policy menus. Weekly spans the real range of full-time policies; daily covers the
// daily-OT states (California's 8 is the common case).
const OT_WEEKLY_DEFAULT_MINUTES = 2400;
const OT_WEEKLY_CHOICES = [30, 32, 35, 40, 44, 48, 50] as const;
const OT_DAILY_CHOICES = [8, 10, 12] as const;

function TeamRolesBlock() {
  const { data, isLoading, isError } = api.v1.identity.members.useQuery();
  const utils = api.useUtils();
  const setToggle = useAppStore((s) => s.setToggle);
  const techSeesPrice = useAppStore((s) => s.toggles.techSeesPrice);
  const techEditsTimes = useAppStore((s) => s.toggles.techEditsTimes);
  // The overtime policy is numbers, not a toggle — read from settings, saved via updateConfig.
  const saveOt = api.v1.settings.updateConfig.useMutation({
    onSuccess: () => void utils.v1.settings.get.invalidate(),
  });
  // Same key as SettingsHydrator (deduped) — read purely to know when toggles are real.
  const settingsQ = api.v1.settings.get.useQuery(undefined, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const settingsLoading = !settingsQ.isFetched && !settingsQ.isError;

  const memberCount = data?.items.length ?? 0;
  const fieldCrewCount = data?.items.filter((m) => m.isFieldCrew).length ?? 0;

  return (
    <>
      <FoldCard mark={<MarkTeam />} title="Your team" defaultOpen summary={isLoading ? "…" : `${memberCount} ${memberCount === 1 ? "person" : "people"}`}>
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

      <FoldCard mark={<MarkPermissions />} title="Sensitive data" summary="permissions">
        <div className="stage-row" style={{ borderTop: "none", marginTop: "0" }}>
          <div style={{ flex: 1 }}>
            <b>Techs can see job prices</b>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>The job total only — your cost and margin stay office-only.</div>
          </div>
          {/* Disabled until settings hydrate — the pre-hydration default is ON, and showing a
              permissions switch in a state the org may have turned off is a false claim. */}
          <label className="switch">
            <input
              type="checkbox"
              checked={techSeesPrice}
              disabled={settingsLoading}
              onChange={(e) => setToggle("techSeesPrice", e.target.checked)}
            />
            <i />
          </label>
        </div>
      </FoldCard>

      {/* Not "sensitive data" — how the shop RECORDS hours, which is a working practice rather
          than a permission. Its own card so it is not read as another thing being withheld from
          the crew. */}
      {/* The two hours cards read as one answer to "how does time become payroll", so the heading
          sits here rather than in SecTeam — the rules card is inside this block and Crew hours
          follows it. */}
      <SetGroup>Hours</SetGroup>
      <FoldCard mark={<MarkPunch />} title="How your crew records hours" summary="written in">
        <div className="stage-row" style={{ borderTop: "none", marginTop: "0" }}>
          <div style={{ flex: 1 }}>
            <b>Techs can edit their own times</b>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              Off, corrections go through you. On, techs write and edit their own week until it
              is submitted.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={techEditsTimes}
              disabled={settingsLoading}
              onChange={(e) => setToggle("techEditsTimes", e.target.checked)}
            />
            <i />
          </label>
        </div>

        <div className="stage-row">
          <div style={{ flex: 1 }}>
            <b>Overtime after (week)</b>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>Hours past this in a week count as overtime.</div>
          </div>
          <div style={{ flex: "0 0 auto", width: 150 }}>
          <SelectMenu
            aria-label="Overtime after, per week"
            value={String(settingsQ.data?.config.otWeeklyThresholdMinutes ?? OT_WEEKLY_DEFAULT_MINUTES)}
            disabled={settingsLoading || saveOt.isPending}
            onChange={(v) => saveOt.mutate({ otWeeklyThresholdMinutes: Number(v) })}
            options={OT_WEEKLY_CHOICES.map((h) => ({ value: String(h * 60), label: `${h} hours` }))}
            compact
          />
          </div>
        </div>

        <div className="stage-row">
          <div style={{ flex: 1 }}>
            <b>Daily overtime after</b>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              Some states add a daily rule — California is 8 hours. Off means only the weekly
              rule applies.
            </div>
          </div>
          <div style={{ flex: "0 0 auto", width: 150 }}>
          <SelectMenu
            aria-label="Daily overtime after"
            value={
              settingsQ.data?.config.otDailyThresholdMinutes == null
                ? ""
                : String(settingsQ.data.config.otDailyThresholdMinutes)
            }
            disabled={settingsLoading || saveOt.isPending}
            onChange={(v) => saveOt.mutate({ otDailyThresholdMinutes: v === "" ? null : Number(v) })}
            options={[
              { value: "", label: "Off" },
              ...OT_DAILY_CHOICES.map((h) => ({ value: String(h * 60), label: `${h} hours` })),
            ]}
            compact
          />
          </div>
        </div>
      </FoldCard>
    </>
  );
}

// ============================================================================
// Section: Integrations
// ============================================================================

/**
 * Everything Mallet plugs into: the money rails, the accounting ledger, the carrier registration
 * that lets it text, the places leads arrive from, and the one-time move-in import.
 *
 * WHY THEY BELONG TOGETHER. These six were scattered across three tabs — QuickBooks and Payments
 * each owned a tab, texting registration and the importer sat in Workspace beside the company's
 * name and tax rate, and the lead marketplaces sat in Channels. What they actually share is not a
 * topic but a SHAPE: each one is a connection to something outside Mallet, each is set up once by
 * whoever stood the shop up, and each can be broken by the other side (a revoked token, an expired
 * campaign, a disconnected account) without anybody in the shop touching it.
 *
 * ORDER IS BY WHAT BREAKS WORST. Payments and QuickBooks first — money stops moving. Texting next:
 * an inactive campaign silently stops every message. Then where leads arrive from, then the
 * importer, which a shop reads once on the day it moves in and never again.
 */
function SecIntegrations() {
  return (
    <>
      <SetGroup>Money</SetGroup>
      <PaymentsCard />
      {/* Directly beneath Connect onboarding: Apple 3.4 wants the way to enable Tap to Pay at the
          end of merchant onboarding, and 3.6 wants it reachable outside checkout. */}
      <TapToPayCard />
      <QuickbooksCard />
      <SquareCard />

      <SetGroup>Messaging</SetGroup>
      <A2pRegistrationCard />

      <SetGroup>Where work comes from</SetGroup>
      <LeadMarketplacesCard />
      <WebsiteFormCard />

      <SetGroup>Your data</SetGroup>
      <ImportCard />
    </>
  );
}

// ============================================================================
// Main page
// ============================================================================

// Single source of truth for tab ids. The deep-link parser derives its whitelist from this — a
// duplicated literal previously let a new tab render in the nav but silently fall back to
// Workspace when linked to directly.
// "you" is last on purpose: everything before it belongs to the COMPANY and everyone in the shop
// sees the same values, while "you" is the only tab whose contents differ per person. They used to
// share the Workspace tab under a heading, so a new office hire opened Settings and saw the
// company's branding, the company's texting registration and their own mobile stacked together
// with nothing saying which of them they could safely change.
interface SectionDef {
  k: SetTab;
  label: string;
  body: React.ReactNode;
}

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SetTab>(DEFAULT_SET_TAB);
  // Deep-link support (/settings?tab=booking) — read once on mount; avoids the
  // useSearchParams/Suspense requirement and any SSR hydration mismatch.
  // ?tab=pricing moved to its own surface (settings-IA decision, Jul 2026) —
  // old links redirect there rather than dead-ending on Workspace.
  useEffect(() => {
    const { redirectTo, tab } = resolveSettingsTab(new URLSearchParams(window.location.search).get("tab"));
    if (redirectTo) {
      router.replace(redirectTo);
      return;
    }
    if (tab) setActiveTab(tab);
  }, [router]);
  const allSections = [
    { k: "company" as SetTab, label: "Company", body: <SecCompany /> },
    { k: "team"    as SetTab, label: "Team",    body: <SecTeam /> },
    { k: "integrations" as SetTab, label: "Integrations", body: <SecIntegrations /> },
    { k: "you" as SetTab, label: "You", body: <SecYou /> },
  ] satisfies SectionDef[];
  /**
   * No per-tab role filter, because there was never a real one. `ownerOnly` was read as
   * `role === "owner" || role === "office" || !ownerOnly`, and a TECH cannot reach /settings at all
   * — the (office) layout guards the route — so the left side was always true and the flag hid
   * nothing from anybody. Keeping it would be keeping a lie about who can see what; if a tab ever
   * genuinely needs owner-only, it needs a check that actually excludes office.
   */
  const sections: SectionDef[] = allSections;

  const tab = sections.some((s) => s.k === activeTab) ? activeTab : DEFAULT_SET_TAB;

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
