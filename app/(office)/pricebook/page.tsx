"use client";

/**
 * Pricebook — the shop's pricing knowledge as a first-class surface (moved out of
 * Settings → Pricing & quotes, Jul 2026 settings-IA decision). It's the living
 * document: services, labor rates, and what the estimator has learned. Markup and
 * terms ride along as quiet defaults at the bottom. Unlike the old owner-only
 * settings tab, this page is reachable by owner AND office (the people who write
 * quotes) — every server procedure it touches was already ownerOrOffice.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { LaborRateKind } from "@/lib/store/slices/settings-slice";
import { FoldCard } from "../settings/fold-card";
import { PricebookCard } from "../settings/pricebook-card";
import { EstimatorMemoryCard } from "../settings/estimator-memory-card";

export default function PricebookPage() {
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
    <div>
      <div className="pagehead">
        <h1>Pricebook</h1>
      </div>
      <div className="sub">What you charge — and what the estimator has learned about how you price.</div>

      <div style={{ maxWidth: 900, marginTop: 14 }}>
        <PricebookCard />

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

        <EstimatorMemoryCard />

        {/* Quiet defaults — rarely changed, kept at the bottom of the surface. */}
        <div className="tsec" style={{ padding: "16px 2px 6px" }}>Defaults</div>

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
    </div>
  );
}
