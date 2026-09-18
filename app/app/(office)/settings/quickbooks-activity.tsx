"use client";

/**
 * Settings → QuickBooks → "What's been sent".
 *
 * Until this existed nothing in the app read `qbo_sync_log`: a push that failed — an unmatched
 * person, a revoked token — looked exactly like one that worked, and the only way to find out was
 * to query the database. That is the silent failure the house rules forbid, and it matters more
 * than usual here because the thing failing quietly is somebody's pay.
 *
 * Failures come first and stay expanded. A success list is a receipt you glance at; a failure is
 * work somebody has to do, and burying it under thirty green rows is the same as hiding it.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";

type Row = RouterOutputs["v1"]["qbo"]["syncActivity"]["rows"][number];

const when = (at: Date): string =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function ProblemRow({ row }: { row: Row }) {
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-3) 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <b style={{ fontSize: "var(--type-base)" }}>{row.label}</b>
        <span className="muted" style={{ fontSize: "var(--type-sm)", whiteSpace: "nowrap" }}>
          {when(row.attemptedAt)}
        </span>
      </div>
      <div style={{ fontSize: "var(--type-base)", color: "var(--ink)" }}>{row.problem?.says}</div>
      {row.problem?.fix ? (
        <div style={{ fontSize: "var(--type-base)", color: "var(--ink-2)" }}>{row.problem.fix}</div>
      ) : null}
      {/* QuickBooks' own words, kept subordinate to our explanation — it is evidence, not the
          message. Shown at all because when Intuit refuses on a detail, their sentence is the
          only thing that names which detail. */}
      {row.detail ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
          QuickBooks said: {row.detail}
        </div>
      ) : null}
    </li>
  );
}

function SentRow({ row }: { row: Row }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        padding: "var(--space-2) 0",
        borderTop: "1px solid var(--line)",
        fontSize: "var(--type-base)",
      }}
    >
      <span>{row.label}</span>
      <span className="muted" style={{ fontSize: "var(--type-sm)", whiteSpace: "nowrap" }}>
        {when(row.attemptedAt)}
      </span>
    </li>
  );
}

export function QuickbooksActivity() {
  const activity = api.v1.qbo.syncActivity.useQuery();

  if (activity.isLoading) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-base)" }} aria-busy="true">
        Loading…
      </p>
    );
  }

  // The log failing to load is itself worth saying: silence here would be indistinguishable from
  // "nothing has gone wrong", which is the exact confusion this screen exists to end.
  if (activity.isError) {
    return (
      <p className="werr" role="alert">
        Couldn&apos;t load what&apos;s been sent. Reload the page to try again.
      </p>
    );
  }

  const rows = activity.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-base)" }}>
        Nothing has been sent yet. Approving a week puts the hours in the queue; they go over on the
        next nightly run.
      </p>
    );
  }

  const problems = rows.filter((r) => r.problem !== null);
  const sent = rows.filter((r) => r.problem === null);

  return (
    <div>
      {problems.length > 0 && (
        <section style={{ marginBottom: "var(--space-4)" }}>
          <h4 style={{ fontSize: "var(--type-md)", fontWeight: 700, margin: 0 }}>
            {problems.length === 1 ? "1 didn’t go over" : `${problems.length} didn’t go over`}
          </h4>
          <ul style={{ listStyle: "none", margin: "var(--space-2) 0 0", padding: 0 }}>
            {problems.map((r) => (
              <ProblemRow key={`${r.entityType}:${r.malletId}:${String(r.attemptedAt)}`} row={r} />
            ))}
          </ul>
        </section>
      )}

      {sent.length > 0 && (
        <section>
          <h4 style={{ fontSize: "var(--type-md)", fontWeight: 700, margin: 0 }}>
            {sent.length === 1 ? "1 sent to QuickBooks" : `${sent.length} sent to QuickBooks`}
          </h4>
          <ul style={{ listStyle: "none", margin: "var(--space-2) 0 0", padding: 0 }}>
            {sent.map((r) => (
              <SentRow key={`${r.entityType}:${r.malletId}:${String(r.attemptedAt)}`} row={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
