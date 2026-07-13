"use client";

/**
 * Settings → Pricing → "Estimator memory" card: what the AI estimator has
 * learned about THIS shop (quoting_rules). Two lists:
 *   - To review: proposed rules (edit-delta mining after ≥2 recurrences,
 *     plus corrections that contradicted an existing rule) — [Confirm][Dismiss].
 *   - Rules in use: confirmed rules the drafters inject — [Forget] invalidates.
 * In-flow, functional copy, no floating UI. Everything here is DB-backed;
 * nothing writes without a tap.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

const SOURCE_LABEL: Record<string, string> = {
  manual: "added here",
  refine: "from a quote correction",
  edit_delta: "learned from your edits",
};

export function EstimatorMemoryCard() {
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

  const summary =
    proposed.length > 0
      ? `${confirmed.length} rule${confirmed.length === 1 ? "" : "s"} · ${proposed.length} to review`
      : `${confirmed.length} rule${confirmed.length === 1 ? "" : "s"}`;

  return (
    <FoldCard title="Estimator memory" summary={summary} defaultOpen={proposed.length > 0}>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: "11.5px" }}>
        Rules the AI estimator follows when it drafts quotes for this shop. It proposes new ones
        from your corrections and repeated edits — nothing is used until you confirm it.
      </p>

      {list.isLoading && <p className="muted" style={{ fontSize: 12 }}>Loading…</p>}
      {list.isError && (
        <p style={{ color: "var(--red, #b42318)", fontSize: 12 }}>
          Couldn&apos;t load the rules — refresh to try again.
        </p>
      )}

      {proposed.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>To review</div>
          {proposed.map((r) => (
            <div key={r.id} className="stage-row">
              <span style={{ flex: 1, fontSize: 13 }}>
                {r.rule}
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {" "}
                  — {SOURCE_LABEL[r.source] ?? r.source}
                  {r.source === "edit_delta" ? `, seen ${r.timesConfirmed}×` : ""}
                </span>
              </span>
              <button
                className="btn sm primary"
                disabled={busy}
                onClick={() => confirm.mutate({ ruleId: r.id })}
              >
                Confirm
              </button>
              <button
                className="btn sm ghost"
                disabled={busy}
                onClick={() => dismiss.mutate({ ruleId: r.id })}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmed.length > 0 ? (
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Rules in use</div>
          {confirmed.map((r) => (
            <div key={r.id} className="stage-row">
              <span style={{ flex: 1, fontSize: 13 }}>
                {r.rule}
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {" "}
                  — {SOURCE_LABEL[r.source] ?? r.source}
                </span>
              </span>
              <button
                className="btn sm ghost"
                disabled={busy}
                onClick={() => dismiss.mutate({ ruleId: r.id })}
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      ) : (
        !list.isLoading &&
        proposed.length === 0 && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Nothing learned yet. Correct an AI draft in the composer (&quot;Refine&quot;) or keep
            editing its quotes — repeated corrections show up here for review.
          </p>
        )
      )}

      {error && (
        <p style={{ color: "var(--red, #b42318)", fontSize: 12, marginTop: 8 }}>{error}</p>
      )}
    </FoldCard>
  );
}
