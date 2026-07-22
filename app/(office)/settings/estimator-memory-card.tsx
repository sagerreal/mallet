"use client";

/**
 * Pricebook → Defaults rail → "Estimator memory" row: what the AI estimator has
 * learned about THIS shop (quoting_rules). Two lists:
 *   - To review: proposed rules (edit-delta mining after ≥2 recurrences,
 *     plus corrections that contradicted an existing rule) — [Confirm][Dismiss].
 *   - Rules in use: confirmed rules the drafters inject — [Forget] invalidates.
 * Renders a DisclosureRow (the quiet-register grammar): the collapsed value IS
 * the summary — "3 rules · 2 to review" — so waiting proposals are visible
 * without opening. In-flow, functional copy, no floating UI; everything is
 * DB-backed and nothing writes without a tap.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { DisclosureRow } from "@/components/ui/disclosure-row";

const SOURCE_LABEL: Record<string, string> = {
  manual: "added here",
  refine: "from a quote correction",
  edit_delta: "learned from your edits",
};

interface RuleView {
  id: string;
  rule: string;
  source: string;
  timesConfirmed: number;
}

function RuleLine({
  rule,
  busy,
  actions,
}: {
  rule: RuleView;
  busy: boolean;
  actions: { label: string; primary?: boolean; onClick: () => void }[];
}) {
  return (
    <div className="stage-row">
      <span style={{ flex: 1, fontSize: "var(--type-base)" }}>
        {rule.rule}
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {" "}
          — {SOURCE_LABEL[rule.source] ?? rule.source}
          {rule.source === "edit_delta" ? `, seen ${rule.timesConfirmed}×` : ""}
        </span>
      </span>
      {actions.map((a) => (
        <button
          key={a.label}
          className={`btn sm ${a.primary ? "primary" : "ghost"}`}
          disabled={busy}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

const summaryFor = (confirmedCount: number, proposedCount: number): string => {
  const rules = `${confirmedCount} rule${confirmedCount === 1 ? "" : "s"}`;
  return proposedCount > 0 ? `${rules} · ${proposedCount} to review` : rules;
};

export interface EstimatorMemoryRowProps {
  open: boolean;
  onToggle: () => void;
}

export function EstimatorMemoryRow({ open, onToggle }: EstimatorMemoryRowProps) {
  const utils = api.useUtils();
  const list = api.v1.quoting.rules.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const [error, setError] = useState<string | null>(null);

  const onDone = () => {
    setError(null);
    void utils.v1.quoting.rules.list.invalidate();
  };
  const onFail = () => setError("Couldn't update the rule — check your connection and try again.");

  const confirm = api.v1.quoting.rules.confirm.useMutation({ onSuccess: onDone, onError: onFail });
  const dismiss = api.v1.quoting.rules.dismiss.useMutation({ onSuccess: onDone, onError: onFail });

  const confirmed = list.data?.confirmed ?? [];
  const proposed = list.data?.proposed ?? [];
  const busy = confirm.isPending || dismiss.isPending;
  const empty = !list.isLoading && confirmed.length === 0 && proposed.length === 0;

  return (
    <DisclosureRow
      label="Estimator memory"
      value={list.isLoading ? "…" : summaryFor(confirmed.length, proposed.length)}
      open={open}
      onToggle={onToggle}
    >
      <p className="muted" style={{ margin: "0 0 var(--space-3)", fontSize: "var(--type-sm)" }}>
        Rules the AI estimator follows when it drafts quotes for this shop. It proposes new ones
        from your corrections and repeated edits — nothing is used until you confirm it.
      </p>

      {list.isLoading && <p className="muted" style={{ fontSize: "var(--type-sm)" }}>Loading…</p>}
      {list.isError && (
        <p style={{ color: "var(--red, #b42318)", fontSize: "var(--type-sm)" }}>
          Couldn&apos;t load the rules — refresh to try again.
        </p>
      )}

      {proposed.length > 0 && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <div style={{ fontWeight: 700, fontSize: "var(--type-base)", marginBottom: "var(--space-1)" }}>To review</div>
          {proposed.map((r) => (
            <RuleLine
              key={r.id}
              rule={r}
              busy={busy}
              actions={[
                { label: "Confirm", primary: true, onClick: () => confirm.mutate({ ruleId: r.id }) },
                { label: "Dismiss", onClick: () => dismiss.mutate({ ruleId: r.id }) },
              ]}
            />
          ))}
        </div>
      )}

      {confirmed.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: "var(--type-base)", marginBottom: "var(--space-1)" }}>Rules in use</div>
          {confirmed.map((r) => (
            <RuleLine
              key={r.id}
              rule={r}
              busy={busy}
              actions={[{ label: "Forget", onClick: () => dismiss.mutate({ ruleId: r.id }) }]}
            />
          ))}
        </div>
      )}

      {empty && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0" }}>
          Nothing learned yet. Correct an AI draft in the composer (&quot;Refine&quot;) or keep
          editing its quotes — repeated corrections show up here for review.
        </p>
      )}

      {error && (
        <p style={{ color: "var(--red, #b42318)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</p>
      )}
    </DisclosureRow>
  );
}
