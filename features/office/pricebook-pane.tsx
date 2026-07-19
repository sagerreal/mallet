"use client";

/**
 * features/office/pricebook-pane.tsx
 * The Pricebook tab of the Office page — the catalog presentation of the SAME
 * editor the settings card had, nothing removed: toolbar (always-on search,
 * labor-rate + markup chips, CSV import), the service list (each row expands
 * in-flow to the full Level-1 editor), the add row + category manager, the
 * plumbing starter seed for an empty book, then the estimator's memory and the
 * quiet Defaults editors (labor rates, markup, terms) moved from /pricebook.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { MODAL } from "@/lib/store/modal-ids";
import type { Service } from "@/lib/store/types";
import type { LaborRateKind } from "@/lib/store/slices/settings-slice";
import { ServiceRow } from "@/app/(office)/settings/service-row";
import { AddServiceRow } from "@/app/(office)/settings/add-service-row";
import { CategoryManager } from "@/app/(office)/settings/category-manager";
import { EstimatorMemoryCard } from "@/app/(office)/settings/estimator-memory-card";
import { FoldCard } from "@/app/(office)/settings/fold-card";

function sortServices(services: Service[]): Service[] {
  return [...services].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

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

  return (
    <div style={{ maxWidth: 900 }}>
      {/* toolbar — search + the shop's rate facts + import */}
      <div className="pbtoolbar">
        <input
          className="pbsearch"
          type="text"
          placeholder="Search services…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search services"
        />
        {laborRates.slice(0, 2).map((lr) => (
          <span key={lr.id} className="ratechip">{lr.name} <b>${lr.rate}{lr.kind === "hourly" ? "/hr" : ""}</b></span>
        ))}
        <span className="ratechip">Markup <b>{markup}%</b></span>
        {canSeeCost && (
          <button className="btn sm ghost" onClick={() => openModal(MODAL.IMPORT_SERVICES)}>
            Import CSV
          </button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="card" style={{ padding: "28px 16px", textAlign: "center" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700 }}>
            Add your common jobs — e.g. “Replace 40gal water heater”.
          </p>
          <button className="btn" onClick={() => void handleSeed()} disabled={seeding}>
            {seeding ? "Adding starter pack…" : "Start with plumbing basics"}
          </button>
          {seedError && (
            <p style={{ color: "var(--red)", fontSize: 12, margin: "8px 0 0" }}>{seedError}</p>
          )}
        </div>
      ) : (
        <div className="pbtablewrap">
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

      <AddServiceRow onAdd={addService} />
      <CategoryManager categories={categories} onAdd={addCategory} />

      <EstimatorMemoryCard />

      {/* Quiet defaults — rarely changed, at the bottom of the surface. */}
      <div className="tsec" style={{ padding: "16px 2px 6px" }}>Defaults</div>

      <FoldCard title="Labor rates" summary={`${laborRates.length} rate${laborRates.length === 1 ? "" : "s"}`}>
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
    </div>
  );
}
