/**
 * components/modals/company-view-modal.tsx
 * The company sheet — the account record in the record-modal grammar.
 *
 * Shape (top to bottom): sticky header (name · archived pill · won/open money
 * facts), a quiet secondary row (New customer; Restore when archived), CUSTOMERS
 * work-rows (the linked leads — tap opens the customer sheet), then the quiet
 * level-0 rows: Work history, Details (phone/email/website/address/notes, commit
 * on blur via updateCompany — immutable patch), and Clean up (archive — the only
 * red, inside the accordion, never at level 0).
 *
 * No sticky footer on purpose: this is a record viewer with peer actions only —
 * there is no single terminal action to promote, and promoting one would invent it.
 *
 * Raw store arrays are selected via hooks; all derivations happen in the component
 * body (NEVER inside a useAppStore selector).
 */

"use client";

import {
  useActiveModal,
  useCompanies,
  useLeads,
  useEstimates,
  usePushModal,
  useCloseModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { StagePill, SoftPill } from "@/components/shared/stage-pill";
import type { Company, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { api } from "@/lib/trpc/client";
import { pipeSum } from "@/lib/estimates";
import { Field } from "@/components/ui/input";
import { SheetRow } from "./sheet-row";

/** Linked leads as work-rows: tap opens the customer sheet. */
function CustomerRows({
  contacts,
  onOpenLead,
}: {
  contacts: Lead[];
  onOpenLead: (id: string) => void;
}) {
  return (
    <>
      {contacts.map((l) => (
        <button
          key={l.id}
          type="button"
          className="sheet-workrow"
          onClick={() => onOpenLead(l.id)}
        >
          <div className="t">
            <b>{l.name}</b>
            <span>{[l.role, l.job || l.last].filter(Boolean).join(" · ")}</span>
          </div>
          <StagePill stage={l.stage} />
          <span className="chev" style={{ color: "var(--ink-3)" }} aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </>
  );
}

/** Work-history accordion body — one entry per linked lead, read-only. */
function WorkHistoryBody({ contacts }: { contacts: Lead[] }) {
  if (contacts.length === 0) {
    return <div className="empty-att">No work yet.</div>;
  }
  return (
    <>
      {contacts.map((l) => (
        <div key={l.id} className="att-item">
          <div className="att-ico" style={{ background: "var(--blue-bg)" }} />
          <div className="att-body">
            <b style={{ fontWeight: 600 }}>{l.job || l.name}</b>
            <div className="why">{[l.name, l.last].filter(Boolean).join(" · ")}</div>
          </div>
          <StagePill stage={l.stage} />
        </div>
      ))}
    </>
  );
}

/** Details accordion body — the editable account fields, commit on blur. */
function DetailsBody({
  company,
  onSave,
}: {
  company: Company;
  onSave: (patch: Partial<Company>) => void;
}) {
  return (
    <>
      <Field label="Phone">
        <input
          type="tel"
          inputMode="tel"
          defaultValue={company.phone}
          placeholder="(925) 555-0123"
          onBlur={(e) => onSave({ phone: e.target.value.trim() })}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          defaultValue={company.email}
          placeholder="office@business.com"
          onBlur={(e) => onSave({ email: e.target.value.trim() })}
        />
      </Field>
      <Field label="Website">
        <input
          type="text"
          defaultValue={company.website ?? ""}
          placeholder="business.com"
          onBlur={(e) => onSave({ website: e.target.value.trim() })}
        />
      </Field>
      <Field label="Office address">
        <input
          type="text"
          defaultValue={company.address ?? ""}
          placeholder="123 Main St, Oakland CA 94601"
          onBlur={(e) => onSave({ address: e.target.value.trim() })}
        />
      </Field>
      <Field label="About this account">
        <textarea
          rows={2}
          defaultValue={company.notes ?? ""}
          placeholder="How you know them, who runs it"
          onBlur={(e) => onSave({ notes: e.target.value.trim() })}
        />
      </Field>
    </>
  );
}

/** Clean-up accordion body — archive lives here, the only red on the sheet. */
function CleanUpBody({ company }: { company: Company }) {
  const updateCompany = useAppStore((s) => s.updateCompany);
  const closeModal = useCloseModal();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
        Hides this account from lists — restore it any time.
      </span>
      <button
        type="button"
        className="btn ghost"
        style={{ minHeight: 44, color: "var(--red)" }}
        onClick={() => {
          updateCompany(company.id, { archived: true });
          closeModal();
        }}
      >
        Archive
      </button>
    </div>
  );
}

export function CompanyViewModalContent() {
  const activeModal = useActiveModal();
  const companies = useCompanies();
  const leads = useLeads();
  const estimates = useEstimates();
  const pushModal = usePushModal();
  const updateCompany = useAppStore((s) => s.updateCompany);

  const companyId = activeModal?.params?.companyId as string | undefined;
  const company = companies.find((c) => c.id === companyId);

  if (!company) {
    // Titled like every other state. A bare sentence in a panel gave no indication
    // of what had been opened, which is worse precisely when something is wrong.
    return (
      <>
        <h2>Company</h2>
        <p className="muted">
          This company record is no longer available — it may have been archived.
        </p>
      </>
    );
  }

  const contacts = leads.filter((l) => l.companyId === company.id && !l.archived);
  // Server rollup — pipeSum over the store's page asserted "\$0 open" for any account
  // whose history predates the loaded page. Store-derived only as a fallback while loading.
  const rollupsQ = api.v1.companies.rollups.useQuery(undefined, { refetchOnWindowFocus: false });
  const roll = rollupsQ.data?.find((r) => r.companyId === company.id);
  const openPipe = roll ? roll.openPipeCents / 100 : pipeSum(contacts, estimates, "sent");
  const revenueWon = roll ? roll.revenueWonCents / 100 : pipeSum(contacts, estimates, "accepted");

  const detailsValue = company.phone.trim() || company.email.trim();
  const workCount = contacts.length;

  return (
    <>
      <div className="sheet-head">
        <h2>{company.name}</h2>
        {/* One constant-weight meta line: archived state + the two money facts the
            old KPI cards carried — won from accepted quotes, open awaiting answer. */}
        <div className="sheet-meta">
          {company.archived && <SoftPill tone="ink">Archived</SoftPill>}
          <span>{fmt$(revenueWon)} won</span>
          <span>{openPipe ? fmt$(openPipe) : "$0"} open</span>
        </div>
      </div>

      {/* Quiet peer actions — no primary on this sheet, so nothing is promoted.
          New-customer pre-links the company: the New-customer modal seeds Business +
          the company name from this param, so the lead lands under Customers. */}
      <div className="sheet-secrow">
        <button
          className="sheet-sec"
          onClick={() => pushModal(MODAL.NEW_CUSTOMER, { companyId: company.id })}
        >
          New customer
        </button>
        {company.archived && (
          <button
            className="sheet-sec"
            onClick={() => updateCompany(company.id, { archived: false })}
          >
            Restore
          </button>
        )}
      </div>

      {/* CUSTOMERS — the linked leads, rows not cards. */}
      <div className="sheet-worklab">Customers</div>
      {contacts.length > 0 ? (
        <CustomerRows
          contacts={contacts}
          onOpenLead={(id) => pushModal(MODAL.LEAD, { leadId: id })}
        />
      ) : (
        <div className="empty-att">
          No customers yet — add one with New customer, or tag any customer with
          this business name. They link automatically.
        </div>
      )}

      <div className="sheet-rows">
        <SheetRow
          label="Work history"
          value={workCount > 0 ? `${workCount} on file` : "None yet"}
          valueIsHint={workCount === 0}
          expandable
        >
          <WorkHistoryBody contacts={contacts} />
        </SheetRow>

        <SheetRow
          label="Details"
          value={detailsValue || "Add"}
          valueIsHint={!detailsValue}
          expandable
        >
          <DetailsBody
            company={company}
            onSave={(patch) => updateCompany(company.id, patch)}
          />
        </SheetRow>

        {/* Neutral ink at level 0; red only on Archive inside. Restore surfaces in
            the secondary row instead once the account is archived. */}
        {!company.archived && (
          <SheetRow label="Clean up" value="archive this account" valueIsHint expandable>
            <CleanUpBody company={company} />
          </SheetRow>
        )}
      </div>
    </>
  );
}
