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
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { MODAL } from "@/lib/store/modal-ids";
import type { Service } from "@/lib/store/types";
import type { LaborRateKind } from "@/lib/store/slices/settings-slice";
import { ServiceRow } from "@/app/(office)/settings/service-row";
import { AddServiceRow } from "@/app/(office)/settings/add-service-row";
import { CategoryManager } from "@/app/(office)/settings/category-manager";
import { EstimatorMemoryRow } from "@/app/(office)/settings/estimator-memory-card";
import { DisclosureRow } from "@/components/ui/disclosure-row";

function sortServices(services: Service[]): Service[] {
  return [...services].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The Defaults-rail rows — one open at a time (front-desk RuleRow precedent). */
type RailKey = "labor" | "markup" | "terms" | "memory" | "categories";

export function PricebookPane() {
  const services = useAppStore((s) => s.services);
  const categories = useAppStore((s) => s.categories);
  const addService = useAppStore((s) => s.addService);
  const updateService = useAppStore((s) => s.updateService);
  const archiveService = useAppStore((s) => s.archiveService);
  const addCategory = useAppStore((s) => s.addCategory);
  const seedPricebook = useAppStore((s) => s.seedPricebook);
  const laborRates = useAppStore((s) => s.laborRates);
  const addLaborRate = useAppStore((s) => s.addLaborRate);
  const updateLaborRate = useAppStore((s) => s.updateLaborRate);
  const removeLaborRate = useAppStore((s) => s.removeLaborRate);
  const markup = useAppStore((s) => s.markup);
  const setMarkup = useAppStore((s) => s.setMarkup);
  const terms = useAppStore((s) => s.terms);
  const addTerm = useAppStore((s) => s.addTerm);
  const removeTerm = useAppStore((s) => s.removeTerm);

  // Cost/margin are sensitive — hidden from tech role (fail closed until role loads).
  const me = useMe();
  const canSeeCost = me.data?.role === "owner" || me.data?.role === "office";

  const openModal = useOpenModal();

  const [query, setQuery] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [openRail, setOpenRail] = useState<RailKey | null>(null);
  const toggleRail = (k: RailKey) => setOpenRail((prev) => (prev === k ? null : k));
  // "Build your own" dismisses first-run into the (empty) register so the inline
  // add-row is right there; the first added service makes it permanent.
  const [building, setBuilding] = useState(false);
  const [lrName, setLrName] = useState("");
  const [lrRate, setLrRate] = useState("");
  const [lrKind, setLrKind] = useState<LaborRateKind>("hourly");
  const [tlName, setTlName] = useState("");
  const [tlBody, setTlBody] = useState("");

  async function handleSeed() {
    setSeeding(true);
    setSeedError(null);
    const result = await seedPricebook();
    setSeeding(false);
    if (!result.ok) {
      setSeedError("Couldn’t load the starter pack — check your connection and try again.");
    }
  }

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
  const gate = { isFetched: svcQuery.isFetched, isError: svcQuery.isError, count: services.length };

  if (isFirstLoad(gate)) {
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
              <b>Services</b>
              <span className="m">{services.length}</span>
              <span className="sp" />
              {canSeeCost && (
                <button className="btn sm ghost" onClick={() => openModal(MODAL.IMPORT_SERVICES)}>
                  Import CSV
                </button>
              )}
            </div>

            {services.length > 0 && (
              <div style={{ padding: "var(--space-3) var(--space-4) var(--space-1)" }}>
                <input
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

            {services.length > 0 && (
              <div style={{ padding: "0 var(--space-4)" }}>
                {visible.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    categories={categories}
                    canSeeCost={canSeeCost}
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
            <div style={{ padding: "0 var(--space-4) var(--space-3)" }}>
              <AddServiceRow onAdd={addService} autoFocus={building && services.length === 0} />
            </div>
          </div>
        </div>

        {/* subordinate rail: the shop's pricing defaults as a definition list */}
        <div className="fdrail">
          <h3>Defaults</h3>

          <DisclosureRow
            label="Labor rates"
            value={`${laborRates.length} rate${laborRates.length === 1 ? "" : "s"}`}
            open={openRail === "labor"}
            onToggle={() => toggleRail("labor")}
          >
            <div>
              {laborRates.map((lr) => (
                <div key={lr.id} className="stage-row">
                  <input type="text" defaultValue={lr.name}
                    onChange={(e) => updateLaborRate(lr.id, "name", e.target.value)}
                    className="field-compact" style={{ flex: 1, minWidth: 100 }} />
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <span className="muted">$</span>
                    <input type="number" inputMode="decimal" defaultValue={lr.rate}
                      onChange={(e) => updateLaborRate(lr.id, "rate", e.target.value)}
                      className="field-compact" style={{ width: 72 }} />
                    <select
                      aria-label={`Unit for ${lr.name}`}
                      value={lr.kind}
                      onChange={(e) => updateLaborRate(lr.id, "kind", e.target.value)}
                      className="tsel"
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
            <div style={{ marginTop: "var(--space-3)" }}>
              <div className="chips" style={{ marginBottom: "var(--space-2)" }}>
                <button type="button" className={`chip${lrKind === "hourly" ? " sel" : ""}`} onClick={() => setLrKind("hourly")}>
                  Hourly
                </button>
                <button type="button" className={`chip${lrKind === "flat_fee" ? " sel" : ""}`} onClick={() => setLrKind("flat_fee")}>
                  Flat fee
                </button>
              </div>
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <input type="text" id="lrName" placeholder="e.g. Diagnostic fee, After-hours" value={lrName} onChange={(e) => setLrName(e.target.value)}
                  className="field-compact" />
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <input type="number" inputMode="decimal" id="lrRate" placeholder={lrKind === "flat_fee" ? "$" : "$/hr"} value={lrRate} onChange={(e) => setLrRate(e.target.value)}
                    className="field-compact" style={{ flex: 1 }} />
                  <button className="btn sm" onClick={handleAddLabor}>+ Add</button>
                </div>
              </div>
            </div>
          </DisclosureRow>

          <DisclosureRow
            label="Parts markup"
            value={<span className="mono">{markup}%</span>}
            open={openRail === "markup"}
            onToggle={() => toggleRail("markup")}
          >
            <div className="field" style={{ maxWidth: 160, margin: "0" }}>
              <label>Markup on new parts (%)</label>
              <input type="number" inputMode="decimal" defaultValue={markup} onChange={(e) => setMarkup(Number(e.target.value))} />
            </div>
            <p className="muted" style={{ marginTop: "var(--space-2)", fontSize: "var(--type-sm)" }}>
              Applied to found-work / T&amp;M parts a tech adds on site — each pricebook line keeps its own price.
            </p>
          </DisclosureRow>

          <DisclosureRow
            label="Terms library"
            value={`${terms.length} term${terms.length === 1 ? "" : "s"}`}
            open={openRail === "terms"}
            onToggle={() => toggleRail("terms")}
          >
            <div>
              {terms.map((t) => (
                <div key={t.id} className="stage-row">
                  <span style={{ fontWeight: 700 }}>{t.t}</span>
                  <span className="trig" style={{ flex: 1, whiteSpace: "normal" }}>{t.body.slice(0, 60)}…</span>
                  <button className="btn sm ghost" onClick={() => removeTerm(t.id)}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: "var(--space-2)", marginTop: terms.length ? "var(--space-3)" : "0" }}>
              <input type="text" id="tlName" placeholder="name (e.g. Repipe terms)" value={tlName} onChange={(e) => setTlName(e.target.value)}
                className="field-compact" />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <input type="text" id="tlBody" placeholder="the fine print…" value={tlBody} onChange={(e) => setTlBody(e.target.value)}
                  className="field-compact" style={{ flex: 1 }} />
                <button className="btn sm" onClick={handleAddTerm}>+ Add</button>
              </div>
            </div>
          </DisclosureRow>

          <EstimatorMemoryRow open={openRail === "memory"} onToggle={() => toggleRail("memory")} />

          <DisclosureRow
            label="Categories"
            value={String(categories.length)}
            open={openRail === "categories"}
            onToggle={() => toggleRail("categories")}
          >
            <CategoryManager categories={categories} onAdd={addCategory} />
          </DisclosureRow>
        </div>
      </div>
    </div>
  );
}
