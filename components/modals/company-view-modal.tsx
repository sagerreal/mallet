/**
 * components/modals/company-view-modal.tsx
 * Faithful port of the prototype's openCo (lines 3034-3088) — the company-detail
 * view. Header + "New customer for {first}" action, revenue/pipeline KPIs, a
 * two-column body: linked leads + work history on the left, editable Details on
 * the right. Details fields commit on blur via updateCompany (immutable patch).
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
  useOpenModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { STAGE_PILL_CLS } from "@/lib/prototype-sample";
import type { Company, Estimate, Lead } from "@/lib/store/types";

/** Estimate total — copied verbatim from lead-modal.tsx. */
function calcEstTotal(e: Estimate): number {
  const sub = e.lines.filter((l) => !l.opt).reduce((s, l) => s + l.q * l.r, 0);
  const disc = sub * ((e.pricing?.disc ?? 0) / 100);
  const taxed = (sub - disc) * ((e.pricing?.tax ?? 0) / 100);
  return sub - disc + taxed;
}

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function pipeSum(contacts: Lead[], estimates: Estimate[], status: string): number {
  const contactIds = new Set(contacts.map((l) => l.id));
  return estimates
    .filter((e) => e.status === status && contactIds.has(e.leadId))
    .reduce((s, e) => s + calcEstTotal(e), 0);
}

interface LinkedLeadsCardProps {
  contacts: Lead[];
  onOpenLead: (id: number) => void;
}

function LinkedLeadsCard({ contacts, onOpenLead }: LinkedLeadsCardProps) {
  return (
    <div className="card">
      <h3>
        Linked leads <span className="pill gray">{contacts.length}</span>
      </h3>
      {contacts.length > 0 ? (
        contacts.map((l) => (
          <div
            key={l.id}
            className="att-item clickable"
            onClick={() => onOpenLead(l.id)}
          >
            <div className="att-ico" style={{ background: "var(--green-50)" }} />
            <div className="att-body">
              <b style={{ fontWeight: 600 }}>{l.name}</b>
              <div className="why">
                {l.role ? `${l.role} · ` : ""}
                {l.job || l.last || ""}
              </div>
            </div>
            <span className={`stamp ${STAGE_PILL_CLS[l.stage] ?? "ink"}`}>
              {l.stage}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-att">
          No customers yet — hit + New customer above, or tag any customer with
          this business name. They link automatically.
        </div>
      )}
    </div>
  );
}

function WorkHistoryCard({ contacts }: { contacts: Lead[] }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3>Work history</h3>
      {contacts.length > 0 ? (
        contacts.map((l) => (
          <div key={l.id} className="att-item">
            <div className="att-ico" style={{ background: "var(--blue-bg)" }} />
            <div className="att-body">
              <b style={{ fontWeight: 600 }}>{l.job || l.name}</b>
              <div className="why">
                {l.name} · {l.last || ""}
              </div>
            </div>
            <span className={`stamp ${STAGE_PILL_CLS[l.stage] ?? "ink"}`}>
              {l.stage}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-att">No work yet.</div>
      )}
    </div>
  );
}

interface DetailsCardProps {
  company: Company;
  onSave: (patch: Partial<Company>) => void;
}

function DetailsCard({ company, onSave }: DetailsCardProps) {
  return (
    <div className="card">
      <h3>Details</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Phone</label>
          <input
            type="text"
            defaultValue={company.phone}
            placeholder="—"
            onBlur={(e) => onSave({ phone: e.target.value.trim() })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Email</label>
          <input
            type="text"
            defaultValue={company.email}
            placeholder="—"
            onBlur={(e) => onSave({ email: e.target.value.trim() })}
          />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Website</label>
          <input
            type="text"
            defaultValue={company.website ?? ""}
            placeholder="—"
            onBlur={(e) => onSave({ website: e.target.value.trim() })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Office address</label>
          <input
            type="text"
            defaultValue={company.address ?? ""}
            placeholder="—"
            onBlur={(e) => onSave({ address: e.target.value.trim() })}
          />
        </div>
      </div>
      <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
        <label>About this account</label>
        <textarea
          rows={2}
          defaultValue={company.notes ?? ""}
          placeholder="how you know them, who runs it…"
          onBlur={(e) => onSave({ notes: e.target.value.trim() })}
        />
      </div>
    </div>
  );
}

export function CompanyViewModalContent() {
  const activeModal = useActiveModal();
  const companies = useCompanies();
  const leads = useLeads();
  const estimates = useEstimates();
  const openModal = useOpenModal();
  const updateCompany = useAppStore((s) => s.updateCompany);

  const companyId = activeModal?.params?.companyId as number | undefined;
  const company = companies.find((c) => c.id === companyId);

  if (!company) {
    return <p className="muted">Company not found.</p>;
  }

  const contacts = leads.filter(
    (l) => l.companyId === company.id && !l.archived,
  );
  const openPipe = pipeSum(contacts, estimates, "sent");
  const revenueWon = pipeSum(contacts, estimates, "accepted");

  const contactLine = [company.phone, company.email].filter(Boolean).join(" · ");

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 2,
          paddingRight: 30,
        }}
      >
        <h2>{company.name}</h2>
        <button
          className="btn primary"
          // deferred: pre-link company
          onClick={() => openModal(MODAL.NEW_CUSTOMER)}
        >
          + New customer for {firstName(company.name)}
        </button>
      </div>

      {contactLine ? (
        <div className="muted" style={{ marginBottom: 12 }}>
          {contactLine}
        </div>
      ) : null}

      <div
        className="kpis"
        style={{
          gridTemplateColumns: "repeat(2,1fr)",
          maxWidth: 480,
          marginBottom: 14,
        }}
      >
        <div className="kpi">
          <div className="lbl">Revenue won</div>
          <div className="val">{fmt$(revenueWon)}</div>
          <div className="hint">from accepted quotes — nothing invented</div>
        </div>
        <div className="kpi">
          <div className="lbl">Open pipeline</div>
          <div className="val">{openPipe ? fmt$(openPipe) : "$0"}</div>
          <div className="hint">quotes awaiting answer</div>
        </div>
      </div>

      <div className="row2">
        <div>
          <LinkedLeadsCard
            contacts={contacts}
            onOpenLead={(id) => openModal(MODAL.LEAD, { leadId: id })}
          />
          <WorkHistoryCard contacts={contacts} />
        </div>
        <div>
          <DetailsCard
            company={company}
            onSave={(patch) => updateCompany(company.id, patch)}
          />
        </div>
      </div>
    </>
  );
}
