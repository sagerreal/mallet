"use client";

/**
 * Import customers from a CSV exported by ANY system (QuickBooks, Google Contacts,
 * Jobber, a spreadsheet). Parses + maps + validates entirely in the browser and
 * sends clean rows to v1.customers.importCustomers in ≤500-row chunks. Dedupe by
 * phone is handled server-side. No file touches the server.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useCloseModal } from "@/lib/store/app-store";
import { parseCsv } from "@/lib/import/parse-csv";
import { autoMap, buildImportRows, type MappingConfig, type BuildResult } from "@/lib/import/map-rows";
import { ImportPill, IMPORT_SELECT_STYLE, CsvDropzone, ImportingLine, ImportDoneCard } from "./import-shared";

const CHUNK = 500;
const TARGETS: { key: keyof Omit<MappingConfig, "sourceTag">; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "lastName", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" },
];

type Phase = "upload" | "map" | "importing" | "done";
interface Summary { created: number; deduped: number; failed: number; }

// Committed-offset progress. `done` is the count of rows already sent AND acknowledged by the
// server, so a retry resumes from there instead of re-sending committed rows (server dedupe is
// phone-only, so a phoneless row re-sent would be created AGAIN as a duplicate). Reset to ZERO
// whenever the file or mapping changes, since `done` only ever indexes into the CURRENT rows.
const ZERO = { done: 0, created: 0, deduped: 0, failed: 0 };

export function ImportCustomersModalContent() {
  const utils = api.useUtils();
  const close = useCloseModal();
  const importMut = api.v1.customers.importCustomers.useMutation();

  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<MappingConfig | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState(ZERO);

  async function processFile(file: File) {
    setError(null);
    try {
      const { headers: h, records: r } = await parseCsv(file);
      setHeaders(h);
      setRecords(r);
      setMap(autoMap(h));
      setProgress(ZERO); // new file → committed offset is meaningless; start fresh
      setPhase("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file.");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  const built: BuildResult | null = map ? buildImportRows(records, map) : null;

  async function runImport() {
    if (!built) return;
    setPhase("importing");
    setError(null);
    let { done, created, deduped, failed } = progress;
    try {
      // Resume from the committed offset; a retry after a mid-batch failure must not re-send
      // already-created rows (server dedupe is phone-only, so phoneless rows would duplicate).
      for (let i = done; i < built.rows.length; i += CHUNK) {
        const res = await importMut.mutateAsync({ rows: built.rows.slice(i, i + CHUNK) });
        created += res.created;
        deduped += res.deduped;
        failed += res.failed;
        done = Math.min(i + CHUNK, built.rows.length);
        setProgress({ done, created, deduped, failed });
        await utils.v1.customers.list.invalidate(); // refresh after each chunk, not only at the end
      }
      setSummary({ created, deduped, failed });
      setPhase("done");
    } catch (err) {
      setProgress({ done, created, deduped, failed }); // persist so a retry RESUMES, not re-sends
      setError(err instanceof Error ? err.message : "Import stopped partway. Saved rows were kept — click Import to finish the rest.");
      setPhase("map");
    }
  }

  function setField(key: keyof Omit<MappingConfig, "sourceTag">, value: string) {
    setMap((m) => (m ? { ...m, [key]: value || null } : m));
    setProgress(ZERO); // mapping changed → the committed offset no longer indexes these rows
  }

  function reset() {
    setPhase("upload");
    setError(null);
    setHeaders([]);
    setRecords([]);
    setMap(null);
    setProgress(ZERO);
  }

  return (
    <div>
      <h2>Import customers</h2>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
            Bring in your customers from QuickBooks, Google Contacts, Jobber, or a spreadsheet — export a
            CSV from that tool and drop it here.
          </p>

          <CsvDropzone dragging={dragging} setDragging={setDragging} onDrop={onDrop} onFile={onFile} />

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-1)" }}>
            We matched your columns to Mallet fields — adjust any that look wrong.
          </p>

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", margin: "var(--space-3) 0 var(--space-4)" }}>
            <ImportPill tone="ready" label={`${built.rows.length} ready`} />
            {built.skipped.length > 0 && <ImportPill tone="skipped" label={`${built.skipped.length} skipped — no name`} />}
            {built.warnings.length > 0 && <ImportPill tone="warn" label={`${built.warnings.length} to import without a bad field`} />}
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {TARGETS.map((t, i) => (
              <label key={t.key} style={{
                display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                borderTop: i === 0 ? "none" : "1px solid var(--manila-line)",
              }}>
                <span style={{ width: 96, fontSize: "var(--type-base)", fontWeight: 700, color: "var(--ink-2)" }}>{t.label}</span>
                <select value={map[t.key] ?? ""} onChange={(e) => setField(t.key, e.target.value)} style={IMPORT_SELECT_STYLE}>
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label style={{
              display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
              borderTop: "1px solid var(--manila-line)", background: "var(--manila)",
            }}>
              <span style={{ width: 96, fontSize: "var(--type-base)", fontWeight: 700, color: "var(--ink-2)" }}>Tag source</span>
              <input value={map.sourceTag} maxLength={255}
                onChange={(e) => { setMap((m) => m ? { ...m, sourceTag: e.target.value } : m); setProgress(ZERO); }}
                style={{ ...IMPORT_SELECT_STYLE }} />
            </label>
          </div>

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-5)" }}>
            <button type="button" className="btn ghost" onClick={reset}>← Choose a different file</button>
            <button type="button" className="btn primary"
              disabled={built.rows.length === 0 || importMut.isPending}
              onClick={runImport}>
              {progress.done > 0
                ? `Resume — ${built.rows.length - progress.done} left`
                : `Import ${built.rows.length} customer${built.rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {phase === "importing" && (
        <ImportingLine done={progress.done} total={built?.rows.length ?? 0} />
      )}

      {phase === "done" && summary && (
        <ImportDoneCard
          headline={`${summary.created} customer${summary.created === 1 ? "" : "s"} added`}
          sub={
            summary.deduped > 0 || summary.failed > 0 ? (
              <>
                {summary.deduped > 0 && `${summary.deduped} already on file`}
                {summary.deduped > 0 && summary.failed > 0 && " · "}
                {summary.failed > 0 && `${summary.failed} couldn’t be read`}
              </>
            ) : undefined
          }
          onClose={close}
        />
      )}
    </div>
  );
}
