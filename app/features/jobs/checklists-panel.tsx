"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ChecklistEditorCard } from "./checklist-editor-card";
import { AddChecklistModal } from "./add-checklist-modal";
import { StarterChecklistsModal } from "./starter-checklists-modal";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

// First-run empty-state copy. Checklists are org-level templates (a library), authored anytime.
const FIRST_RUN = {
  heading: "No checklists yet",
  subtext: "Checklists are the steps your crew works through on a job. Load a ready-made set for your trade, or build your own.",
  starter: {
    title: "Start from your trade",
    description: "Load proven checklists for your trade — edit them to match how you work.",
    actionLabel: "Choose trade",
  },
  build: {
    title: "Build your own",
    description: "Name a checklist and add the steps and photo checks you want.",
    actionLabel: "+ New checklist",
  },
} as const;

export function ChecklistsPanel() {
  const checklists = useAppStore((s) => s.checklists);
  const addChecklist = useAppStore((s) => s.addChecklist);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [query, setQuery] = useState("");
  // No-flash first-run gate — dedupes the ChecklistsHydrator query (same key → no extra fetch).
  const clQuery = api.v1.checklists.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const firstRun = shouldShowFirstRun({ isFetched: clQuery.isFetched, isError: clQuery.isError, count: checklists.length });
  const loadFailed = shouldShowLoadFailed({ isFetched: clQuery.isFetched, isError: clQuery.isError, count: checklists.length });
  const loading = isFirstLoad({ isFetched: clQuery.isFetched, isError: clQuery.isError, count: checklists.length });

  // AI-draft (1A.4) passes proposed items; a plain add passes none. Either way the
  // new row is created and expanded so the owner edits/saves through the normal path
  // (drafted items are suggestions, never auto-published).
  function handleAdd(
    name: string,
    items: Array<{ text: string; type: "check" | "photo" }> = [],
  ) {
    const { checklist } = addChecklist(name, "job", items);
    setExpandedId(checklist.id);
    setAddOpen(false);
  }

  function handleSeedTrade(
    _tradeKey: string,
    items: Array<{ name: string; items: Array<{ text: string; type: "check" | "photo" }> }>,
  ) {
    // Batch add, dedupe by name
    const existingNames = new Set(checklists.map((c) => c.name));
  const q = query.trim().toLowerCase();
  const visibleChecklists = q ? checklists.filter((c) => c.name.toLowerCase().includes(q)) : checklists;
    items.forEach(({ name, items: itms }) => {
      if (!existingNames.has(name)) {
        addChecklist(name, "job", itms);
        existingNames.add(name);
      }
    });
    setStarterOpen(false);
  }

  function handleToggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const existingNames = new Set(checklists.map((c) => c.name));
  const q = query.trim().toLowerCase();
  const visibleChecklists = q ? checklists.filter((c) => c.name.toLowerCase().includes(q)) : checklists;

  return (
    <div style={{ padding: "var(--space-5) var(--space-6)" }}>
      {/* Header — wraps under 760px (panel-head/panel-head-ctrls in prototype.css) so
          the heading, search, and two buttons never force the pane wider than the
          viewport. Desktop keeps the row/space-between shape unchanged. */}
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: "0", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.02em" }}>Checklists</h2>
        <div className="panel-head-ctrls" style={{ display: "flex", gap: "var(--space-2)" }}>
          <input
            enterKeyHint="search"
            type="text"
            placeholder="Search checklists…"
            aria-label="Search checklists"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ border: "1.4px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--type-base)", fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" }}
          />
          <button className="btn ghost" onClick={() => setStarterOpen(true)}>Starter checklists</button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>+ New checklist</button>
        </div>
      </div>

      {/* Empty state — first-run screen only once the list has loaded and is genuinely empty. */}
      {checklists.length === 0 ? (
        loading ? (
          <ListLoading />
        ) : loadFailed ? (
          <LoadFailed noun="checklists" onRetry={() => void clQuery.refetch()} retrying={clQuery.isRefetching} />
        ) : firstRun ? (
          <FirstRunEmptyState
            heading={FIRST_RUN.heading}
            subtext={FIRST_RUN.subtext}
            paths={[
              { ...FIRST_RUN.starter, onAction: () => setStarterOpen(true), variant: "primary" },
              { ...FIRST_RUN.build, onAction: () => setAddOpen(true) },
            ]}
          />
        ) : null
      ) : (
        /* List — bordered card with rows */
        <div style={{ border: "1px solid var(--line-2, var(--line))", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {visibleChecklists.map((cl, i) => (
            <ChecklistEditorCard
              key={cl.id}
              checklist={cl}
              isExpanded={expandedId === cl.id}
              onToggle={() => handleToggle(cl.id)}
              isLast={i === visibleChecklists.length - 1}
            />
          ))}
          {visibleChecklists.length === 0 && (
            <div className="empty-att">No checklists match “{query}”.</div>
          )}
        </div>
      )}

      <AddChecklistModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
      <StarterChecklistsModal
        open={starterOpen}
        onClose={() => setStarterOpen(false)}
        onSeed={handleSeedTrade}
        existingNames={existingNames}
      />
    </div>
  );
}
