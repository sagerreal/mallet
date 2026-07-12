"use client";

/**
 * Settings → Pricing & quotes → "Pricebook" card — the progressively-disclosed catalog
 * editor (the headline UX of the pricebook restructure). Level 0 is a flat name→price
 * list + one add row (AddServiceRow), identical in spirit to the old flat editor. Each
 * row expands in-flow (▸/▾, no floating UI) to Level 1 details (category, cost/margin,
 * labor hours, taxable, warranty) via ServiceRow. Category management is a small
 * in-flow reveal beneath the add row (CategoryManager). A search box appears only once
 * the book is big enough to need one (>15 services) — a small shop never sees it.
 *
 * Deferred to later tasks: the "Start with plumbing basics" seed button (Task 8,
 * wires v1.pricebook.seed), CSV import, materials ("Break into parts"), and
 * Good/Better/Best option groups (Phase 2/3) — omitted here rather than left as
 * dead buttons.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import type { Service } from "@/lib/store/types";
import { FoldCard } from "./fold-card";
import { ServiceRow } from "./service-row";
import { AddServiceRow } from "./add-service-row";
import { CategoryManager } from "./category-manager";

const SEARCH_THRESHOLD = 15;

function sortServices(services: Service[]): Service[] {
  return [...services].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function PricebookCard() {
  const services = useAppStore((s) => s.services);
  const categories = useAppStore((s) => s.categories);
  const addService = useAppStore((s) => s.addService);
  const updateService = useAppStore((s) => s.updateService);
  const archiveService = useAppStore((s) => s.archiveService);
  const addCategory = useAppStore((s) => s.addCategory);

  // Cost/margin are sensitive — hidden from tech role (fail closed until role loads),
  // matching the isOffice gate already used elsewhere (e.g. tech-job-modal.tsx).
  const me = useMe();
  const canSeeCost = me.data?.role === "owner" || me.data?.role === "office";

  const [query, setQuery] = useState("");

  const sorted = sortServices(services);
  const showSearch = services.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visible = showSearch && q ? sorted.filter((s) => s.name.toLowerCase().includes(q)) : sorted;

  return (
    <FoldCard title="Pricebook" defaultOpen summary={`${services.length} service${services.length === 1 ? "" : "s"}`}>
      {showSearch && (
        <input
          type="text"
          placeholder="Search services…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13, marginBottom: 10 }}
        />
      )}

      {services.length === 0 ? (
        <div className="empty-att">
          Add your common jobs — e.g. “Replace 40gal water heater”.
          {/* TODO(Task 8): "Start with plumbing basics" seed button → v1.pricebook.seed */}
        </div>
      ) : (
        <div>
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
    </FoldCard>
  );
}
