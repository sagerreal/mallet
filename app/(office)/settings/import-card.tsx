"use client";

/**
 * Settings → Workspace → Import.
 *
 * The MIGRATION surface: one place a shop moving off Jobber or Housecall Pro can see everything
 * it can bring, and in what order. The per-page Import buttons stay — they are the MAINTENANCE
 * surface, for the shop that is already set up and wants to refresh its price book in March. Both
 * open the same modal.
 *
 * Order is a dependency, not a preference: jobs reference customers by name, so importing
 * customers first means a job row MATCHES an existing record instead of creating a second one.
 * It is stated rather than enforced — a shop re-importing only jobs later must not be blocked.
 */

import { api } from "@/lib/trpc/client";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { ModalId } from "@/lib/store/modal-ids";
import { FoldCard } from "./fold-card";

interface ImportEntity {
  readonly key: string;
  readonly label: string;
  /** What a shop recognises this as — their words, not the schema's. */
  readonly blurb: string;
  readonly modal: ModalId;
}

const ENTITIES: readonly ImportEntity[] = [
  {
    key: "customers",
    label: "Customers",
    blurb: "Names, phone numbers, addresses. Bring these first — jobs match against them.",
    modal: MODAL.IMPORT_CUSTOMERS,
  },
  {
    key: "companies",
    label: "Companies",
    // Next to Customers: both are who the shop bills, and a contact can belong to an account.
    blurb: "The businesses you bill — property managers, GCs, facilities teams.",
    modal: MODAL.IMPORT_COMPANIES,
  },
  {
    key: "services",
    label: "Price book",
    blurb: "Your services and prices. Re-import later to update them.",
    modal: MODAL.IMPORT_SERVICES,
  },
  {
    key: "materials",
    label: "Materials",
    blurb: "The parts you stock. Re-import a supplier's sheet to update costs.",
    modal: MODAL.IMPORT_MATERIALS,
  },
  {
    key: "jobs",
    label: "Jobs",
    blurb: "Scheduled and open work. Rows with a date land on the schedule.",
    modal: MODAL.IMPORT_JOBS,
  },
];

/** "412 imported" / "Nothing imported yet" — state, not a promise. */
function countLabel(count: number | undefined, noun: string): string {
  if (count === undefined) return "…";
  if (count === 0) return "None yet";
  return `${count.toLocaleString("en-US")} ${noun}`;
}

export function ImportCard() {
  const openModal = useOpenModal();

  // What the shop already has. Counts are the honest answer to "did my import work?" — better
  // than a per-entity "last imported" stamp, which would say nothing about the 30 rows that
  // failed.
  const customers = api.v1.customers.count.useQuery({}, { refetchOnWindowFocus: false });
  const jobs = api.v1.jobs.count.useQuery({}, { refetchOnWindowFocus: false });
  const services = api.v1.pricebook.service.importNames.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const materials = api.v1.pricebook.material.importNames.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const companies = api.v1.companies.importNames.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const counts: Record<string, string> = {
    customers: countLabel(customers.data?.total, "on file"),
    companies: countLabel(companies.data?.names.length, "accounts"),
    services: countLabel(services.data?.names.length, "services"),
    materials: countLabel(materials.data?.names.length, "materials"),
    jobs: countLabel(jobs.data?.total, "jobs"),
  };

  return (
    <FoldCard title="Import" summary="Bring your data across">
      <p
        className="muted"
        style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)", lineHeight: 1.5 }}
      >
        Moving from another system? Export a CSV from it and bring each of these across. Import
        customers first — jobs match against them by name, so doing it the other way round creates
        duplicates.
      </p>

      <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {ENTITIES.map((entity, i) => (
          <div
            key={entity.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-3) var(--space-4)",
              borderTop: i === 0 ? "none" : "1px solid var(--manila-line)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <b style={{ fontSize: "var(--type-base)" }}>{entity.label}</b>
                <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                  {counts[entity.key]}
                </span>
              </div>
              <div
                className="muted"
                style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)", lineHeight: 1.4 }}
              >
                {entity.blurb}
              </div>
            </div>
            <button className="btn ghost" onClick={() => openModal(entity.modal)}>
              Import
            </button>
          </div>
        ))}
      </div>
    </FoldCard>
  );
}
