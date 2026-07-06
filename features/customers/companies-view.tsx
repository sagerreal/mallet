/**
 * features/customers/companies-view.tsx
 * Faithful port of the prototype's custBiz / coColDefs / coCell / companiesFiltered
 * (lines 2871-2933). The Companies segment of the Customers page — business accounts
 * that roll up their people, open pipeline, revenue won, and sites.
 *
 * Raw store arrays are selected via hooks; all derivations happen in the component
 * body (NEVER inside a useAppStore selector — deriving an array there triggers an
 * infinite render loop).
 */

"use client";

import { useMemo, useState } from "react";
import {
  useCompanies,
  useLeads,
  useEstimates,
  useOpenModal,
  useCustSeg,
  useSetCustSeg,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Company, Estimate, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { pipeSum } from "@/lib/estimates";
import { pressable } from "@/lib/a11y";

function contactsOf(company: Company, leads: Lead[]): Lead[] {
  return leads.filter((l) => l.companyId === company.id && !l.archived);
}

function sitesCount(company: Company, contacts: Lead[]): number {
  const derived = new Set(
    contacts.map((l) => l.address).filter((a): a is string => Boolean(a)),
  );
  return derived.size + company.sites.length;
}

interface CompanyRow {
  company: Company;
  people: number;
  phone: string;
  openPipe: number;
  revenueWon: number;
  sites: number;
}

const CO_COLS = [
  { key: "people", label: "People" },
  { key: "phone", label: "Phone" },
  { key: "pipe", label: "Open pipeline" },
  { key: "revenue", label: "Revenue won" },
  { key: "sites", label: "Sites" },
] as const;

export function CompaniesView() {
  const companies = useCompanies();
  const leads = useLeads();
  const estimates = useEstimates();
  const openModal = useOpenModal();
  const custSeg = useCustSeg();
  const setCustSeg = useSetCustSeg();
  const addCompany = useAppStore((s) => s.addCompany);

  const [q, setQ] = useState("");

  const rows = useMemo<CompanyRow[]>(() => {
    const query = q.trim().toLowerCase();
    return companies
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .map((company) => {
        const contacts = contactsOf(company, leads);
        return {
          company,
          people: contacts.length,
          phone: company.phone,
          openPipe: pipeSum(contacts, estimates, "sent"),
          revenueWon: pipeSum(contacts, estimates, "accepted"),
          sites: sitesCount(company, contacts),
        };
      });
  }, [companies, leads, estimates, q]);

  function openCompany(id: number) {
    openModal(MODAL.COMPANY, { companyId: id });
  }

  function newCompany() {
    const c = addCompany("New company");
    openModal(MODAL.COMPANY, { companyId: c.id });
  }

  function renderCell(row: CompanyRow, key: (typeof CO_COLS)[number]["key"]) {
    switch (key) {
      case "people":
        return row.people;
      case "phone":
        return row.phone || <span className="muted">—</span>;
      case "pipe":
        return row.openPipe ? fmt$(row.openPipe) : "—";
      case "revenue":
        return row.revenueWon ? fmt$(row.revenueWon) : "—";
      case "sites":
        return row.sites || "—";
      default:
        return null;
    }
  }

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
        <h1>Customers</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={newCompany}>
            + New company
          </button>
        </div>
      </div>
      <div className="sub">
        Business accounts — property managers, GCs, facilities. Each rolls up its
        people &amp; sites.
      </div>

      {/* Segment tabs — toggling back to People must still work */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, marginTop: 12 }}>
        <button
          className={`btn sm${custSeg === "people" ? " primary" : " ghost"}`}
          onClick={() => setCustSeg("people")}
        >
          People
        </button>
        <button
          className={`btn sm${custSeg === "biz" ? " primary" : " ghost"}`}
          onClick={() => setCustSeg("biz")}
        >
          Companies
        </button>
      </div>

      {/* Search */}
      <div className="toolbar">
        <input
          type="text"
          aria-label="Search businesses" placeholder="Search businesses…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted" style={{ marginLeft: "auto" }}>
          {rows.length} of {companies.length}
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
          <thead>
            <tr>
              <th>Business</th>
              {CO_COLS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr
                  key={row.company.id}
                  className="clickable"
                  onClick={() => openCompany(row.company.id)}
                {...pressable(() => openCompany(row.company.id))}
                >
                  <td>
                    <b>{row.company.name}</b>
                  </td>
                  {CO_COLS.map((col) => (
                    <td key={col.key}>{renderCell(row, col.key)}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={CO_COLS.length + 1}>
                  <div className="empty-att">Nothing matches.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted">
        People join a company automatically when you mark a lead with its name — or
        link them from any lead&apos;s More details.
      </p>
    </div>
  );
}
