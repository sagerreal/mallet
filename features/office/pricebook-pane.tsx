"use client";

/**
 * features/office/pricebook-pane.tsx
 * The Pricebook tab in the SAME quiet register as Front Desk: one main object
 * (the Services card — search, list, inline add) beside a subordinate Defaults
 * rail (definition-list disclosure rows: labor rates, parts markup, terms,
 * estimator memory, categories — label over live value, one editor open at a
 * time, everything in-flow). Nothing removed from the old pane: the toolbar's
 * rate chips became the rail's live values; the stray add-row is anchored
 * inside the card; the FoldCard pile is gone.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { measurementConfirmed } from "@/lib/measurement-gate";
import { useMeasurementGate } from "@/features/settings/measurement-gate-provider";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { MODAL } from "@/lib/store/modal-ids";
import type { Service } from "@/lib/store/types";
import type { LaborRateKind } from "@/lib/store/slices/settings-slice";
import { ServiceRow } from "@/app/(office)/settings/service-row";
import { MaterialsPanel } from "@/features/office/materials-panel";
import { AssembliesPanel } from "@/features/office/assemblies-panel";
import { AddServiceRow } from "@/app/(office)/settings/add-service-row";
import { Field } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";

function sortServices(services: Service[]): Service[] {
  return [...services].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The Defaults-rail rows — one open at a time (front-desk RuleRow precedent). */

export function PricebookPane() {
  const services = useAppStore((s) => s.services);
  const assemblies = useAppStore((s) => s.assemblies);
  const addService = useAppStore((s) => s.addService);
  const updateService = useAppStore((s) => s.updateService);
  const archiveService = useAppStore((s) => s.archiveService);
  const seedPricebook = useAppStore((s) => s.seedPricebook);
  // FAILS CLOSED, unlike the scan affordances. The Assemblies segment and the service editor's
  // measured "Priced by" options write a `measuredBy` unit onto a saved service — a real edit to
  // the shop's catalogue — so they need a CONFIRMED yes, not a guess made during a settings
  // outage. See lib/measurement-gate.ts for why each reader picks its own fail direction.
  // Reads through the provider, not the raw store: the raw value is `"unknown"` on the first paint
  // of every cold load, so a painter's measured options were withheld for a beat and then appeared.
  const measurementEstimating = measurementConfirmed(useMeasurementGate());

  // Cost/margin are sensitive — hidden from tech role (fail closed until role loads).
  const me = useMe();
  const canSeeCost = me.data?.role === "owner" || me.data?.role === "office";

  const openModal = useOpenModal();

  const [query, setQuery] = useState("");
  // Services | Materials (+ Assemblies for measurement-estimating orgs) — one
  // catalog; assemblies are the recipe-priced scopes traced surfaces seed through.
  const [pbSeg, setPbSeg] = useState<"services" | "materials" | "assemblies">("services");
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  // "Build your own" dismisses first-run into the (empty) register so the inline
  // add-row is right there; the first added service makes it permanent.
  const [building, setBuilding] = useState(false);

  async function handleSeed() {
    setSeeding(true);
    setSeedError(null);
    const result = await seedPricebook();
    setSeeding(false);
    if (!result.ok) {
      setSeedError("Couldn’t load the starter pack — check your connection and try again.");
    }
  }

  const sorted = sortServices(services);
  const q = query.trim().toLowerCase();
  const visible = q ? sorted.filter((s) => s.name.toLowerCase().includes(q)) : sorted;

  // Dedupe the pricebook hydrator's query (same key + options → one network
  // fetch) purely for load-state flags — the four-state gate every list
  // surface carries: loading / load-failed / first-run / populated.
  const svcQuery = api.v1.pricebook.service.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  // The rates/markup/terms rail reads settings-slice state whose pre-hydration values are
  // DEFAULTS ("0 rates", 35% markup) — a shop running 22% must not see 35% for a beat. Same
  // key as SettingsHydrator (deduped); folded into the same whole-pane loading gate.
  const settingsQ = api.v1.settings.get.useQuery(undefined, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  const materialsAll = useAppStore((s) => s.materials);
  const activeMaterials = materialsAll.filter((m) => m.active);
  const settingsLoading = !settingsQ.isFetched && !settingsQ.isError;
  const gate = { isFetched: svcQuery.isFetched, isError: svcQuery.isError, count: services.length };

  if (isFirstLoad(gate) || settingsLoading) {
    return (
      <div style={{ maxWidth: 980 }}>
        <ListLoading label="Loading pricebook…" />
      </div>
    );
  }

  if (shouldShowLoadFailed(gate)) {
    return (
      <div style={{ maxWidth: 980 }}>
        <LoadFailed noun="pricebook" onRetry={() => void svcQuery.refetch()} retrying={svcQuery.isRefetching} />
      </div>
    );
  }

  if (shouldShowFirstRun(gate) && !building) {
    return (
      <div style={{ maxWidth: 980 }}>
        <FirstRunEmptyState
          heading="No services yet"
          subtext="Your pricebook is the jobs you sell and what they cost — quotes, invoices, and the Front Desk all price from it. Load a ready-made set for your trade, or build your own."
          paths={[
            {
              title: "Start from your trade",
              description: "Load a proven plumbing pricebook — edit names and prices to match how you work.",
              actionLabel: seeding ? "Adding starter pack…" : "Start with plumbing basics",
              onAction: () => void handleSeed(),
              variant: "primary",
            },
            {
              title: "Build your own",
              description: "Add your common jobs one at a time — e.g. “Replace 40gal water heater”.",
              actionLabel: "+ Add a service",
              onAction: () => setBuilding(true),
            },
          ]}
        />
        {seedError && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", textAlign: "center", margin: "var(--space-3) 0 0" }}>
            {seedError}
          </p>
        )}
        {canSeeCost && (
          <p className="muted" style={{ textAlign: "center", fontSize: "var(--type-sm)", margin: "var(--space-4) 0 0" }}>
            Have a spreadsheet?{" "}
            <span className="linklike" onClick={() => openModal(MODAL.IMPORT_SERVICES)}>
              Import CSV
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="fdcols">
        {/* main object: the services catalog, one card */}
        <div>
          <div className="svccard">
            <div className="svccard-h">
              {/* Services | Materials — one catalog, two item kinds (the ST/HCP model:
                  a quote is built from any mix; materials are the sellable parts side). */}
              <div className="segctl pbseg" role="group" aria-label="Pricebook section">
                <button className={pbSeg === "services" ? "on" : ""} onClick={() => setPbSeg("services")}>
                  Services <span className="m">{services.length}</span>
                </button>
                <button className={pbSeg === "materials" ? "on" : ""} onClick={() => setPbSeg("materials")}>
                  Materials <span className="m">{activeMaterials.length}</span>
                </button>
                {measurementEstimating && (
                  <button
                    className={pbSeg === "assemblies" ? "on" : ""}
                    onClick={() => setPbSeg("assemblies")}
                  >
                    Assemblies <span className="m">{assemblies.length}</span>
                  </button>
                )}
              </div>
              <span className="sp" />
              {canSeeCost && pbSeg === "services" && (
                <button className="btn sm ghost" onClick={() => openModal(MODAL.IMPORT_SERVICES)}>
                  Import CSV
                </button>
              )}
            </div>

            {pbSeg === "services" && services.length > 0 && (
              <div style={{ padding: "var(--space-3) var(--space-4) var(--space-1)" }}>
                <input
                  enterKeyHint="search"
                  className="pbsearch"
                  type="text"
                  placeholder="Search services…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search services"
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {/* Add sits at the TOP — a 36-row book shouldn't require a scroll to grow. */}
            {pbSeg === "services" && (
              <div style={{ padding: "var(--space-2) var(--space-4) 0" }}>
                <AddServiceRow onAdd={addService} autoFocus={building && services.length === 0} />
              </div>
            )}
            {pbSeg === "services" && services.length > 0 && (
              <div style={{ padding: "0 var(--space-4)" }}>
                {visible.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    categories={[]}
                    canSeeCost={canSeeCost}
                    measurementEstimating={measurementEstimating}
                    onUpdate={updateService}
                    onArchive={archiveService}
                  />
                ))}
                {visible.length === 0 && (
                  <div className="empty-att">No services match “{query}”.</div>
                )}
              </div>
            )}

            {/* Inline add — anchored at the card's foot, never a stray row on the page.
                Autofocused when arriving via first-run's "Build your own". */}
            {pbSeg === "materials" && (
              <MaterialsPanel canSeeCost={canSeeCost} />
            )}
            {pbSeg === "assemblies" && <AssembliesPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
