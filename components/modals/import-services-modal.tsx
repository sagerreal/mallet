"use client";

/**
 * Import price book services from a CSV exported by ANY system (Housecall Pro,
 * Jobber, ServiceTitan, QuickBooks, a spreadsheet). Parses + maps + validates
 * entirely in the browser (money strings → cents) and sends clean rows to
 * v1.pricebook.importServices in ≤500-row chunks. Category find-or-create and
 * dedupe-by-name are handled server-side. No file touches the server.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useCloseModal } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import { parseCsv } from "@/lib/import/parse-csv";
import {
  autoMapService,
  buildServiceImportRows,
  type ServiceMappingConfig,
  type ServiceBuildResult,
} from "@/lib/import/map-service-rows";

const CHUNK = 500;
const PREVIEW_ROWS = 4;
const TARGETS: { key: keyof ServiceMappingConfig; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "price", label: "Price" },
  { key: "cost", label: "Cost" },
  { key: "code", label: "Code" },
  { key: "description", label: "Description" },
  { key: "taxable", label: "Taxable" },
];

type Phase = "upload" | "map" | "importing" | "done";
interface Summary { created: number; deduped: number; failed: number; }

// Committed-offset progress. `done` is the count of rows already sent AND acknowledged by the
// server, so a retry resumes from there instead of re-sending committed rows (server dedupe is
// name-only, so a re-sent row would be created AGAIN as a duplicate name check race). Reset to
// ZERO whenever the file or mapping changes, since `done` only ever indexes into CURRENT rows.
const ZERO = { done: 0, created: 0, deduped: 0, failed: 0 };

const selectStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)", background: "var(--card)", color: "var(--ink)",
};

function Pill({ label, tone }: { label: string; tone: "ready" | "skipped" | "warn" }) {
  const tones: Record<string, React.CSSProperties> = {
    ready: { background: "var(--green-100)", color: "var(--ink)" },
    skipped: { background: "var(--manila-2)", color: "var(--ink-2)" },
    warn: { background: "var(--amber-bg)", color: "var(--amber)" },
  };
  return (
    <span style={{ ...tones[tone], borderRadius: "var(--radius-pill)", padding: "var(--space-1) var(--space-3)", fontSize: "var(--type-sm)", fontWeight: 700 }}>
      {label}
    </span>
  );
}

export function ImportServicesModalContent() {
  const utils = api.useUtils();
  const close = useCloseModal();
  const importMut = api.v1.pricebook.importServices.useMutation();

  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<ServiceMappingConfig | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState(ZERO);

  async function processFile(file: File) {
    setError(null);
    try {
      const { headers: h, records: r } = await parseCsv(file);
      setHeaders(h);
      setRecords(r);
      setMap(autoMapService(h));
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

  const built: ServiceBuildResult | null = map ? buildServiceImportRows(records, map) : null;

  async function runImport() {
    if (!built) return;
    setPhase("importing");
    setError(null);
    let { done, created, deduped, failed } = progress;
    try {
      // Resume from the committed offset; a retry after a mid-batch failure must not re-send
      // already-created rows (server dedupe is name-only, so a re-sent row would be re-classified
      // as a duplicate rather than created).
      for (let i = done; i < built.rows.length; i += CHUNK) {
        const res = await importMut.mutateAsync({ rows: built.rows.slice(i, i + CHUNK) });
        created += res.created;
        deduped += res.deduped;
        failed += res.failed;
        done = Math.min(i + CHUNK, built.rows.length);
        setProgress({ done, created, deduped, failed });
        await utils.v1.pricebook.service.list.invalidate(); // refresh after each chunk, not only at the end
      }
      setSummary({ created, deduped, failed });
      setPhase("done");
    } catch (err) {
      setProgress({ done, created, deduped, failed }); // persist so a retry RESUMES, not re-sends
      setError(err instanceof Error ? err.message : "Import stopped partway. Saved rows were kept — click Import to finish the rest.");
      setPhase("map");
    }
  }

  function setField(key: keyof ServiceMappingConfig, value: string) {
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
      <h2>Import price book</h2>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
            Bring in your price book from Housecall Pro, Jobber, ServiceTitan, or a spreadsheet —
            export a CSV and drop it here.
          </p>

          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)",
              padding: "var(--space-8) var(--space-5)", textAlign: "center", cursor: "pointer",
              border: `2px dashed ${dragging ? "var(--ink)" : "var(--manila-line)"}`,
              borderRadius: "var(--radius-lg)", background: dragging ? "var(--green-100)" : "var(--manila)",
              transition: "border-color .12s, background .12s",
            }}
          >
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--ink-3)"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div style={{ fontWeight: 700, fontSize: "var(--type-md)", color: "var(--ink)" }}>
              Drag a CSV here, or click to browse
            </div>
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>.csv files only · up to a few thousand rows</div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Upload a CSV file"
              style={{ position: "absolute", width: 1, height: 1, padding: "0", margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0 }} />
          </label>

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-1)" }}>
            We matched your columns to Mallet fields — adjust any that look wrong.
          </p>

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", margin: "var(--space-3) 0 var(--space-3)" }}>
            <Pill tone="ready" label={`${built.rows.length} ready`} />
            {built.skipped.length > 0 && <Pill tone="skipped" label={`${built.skipped.length} skipped — no name`} />}
            {built.warnings.length > 0 && <Pill tone="warn" label={`${built.warnings.length} imported at $0`} />}
          </div>

          {built.rows.length > 0 && (
            <div style={{ margin: "0 0 var(--space-4)", fontSize: "var(--type-base)", color: "var(--ink-2)" }}>
              {built.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                <div key={i} style={{ padding: "var(--space-2xs) 0" }}>
                  {row.name} · {row.category ?? "—"} · {fmt$(row.unitPriceCents / 100)}
                </div>
              ))}
              {built.rows.length > PREVIEW_ROWS && (
                <div style={{ padding: "var(--space-2xs) 0" }}>+ {built.rows.length - PREVIEW_ROWS} more</div>
              )}
            </div>
          )}

          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {TARGETS.map((t, i) => (
              <label key={t.key} style={{
                display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                borderTop: i === 0 ? "none" : "1px solid var(--manila-line)",
              }}>
                <span style={{ width: 96, fontSize: "var(--type-base)", fontWeight: 700, color: "var(--ink-2)" }}>{t.label}</span>
                <select value={map[t.key] ?? ""} onChange={(e) => setField(t.key, e.target.value)} style={selectStyle}>
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-5)" }}>
            <button type="button" className="btn ghost" onClick={reset}>← Choose a different file</button>
            <button type="button" className="btn primary"
              disabled={built.rows.length === 0 || importMut.isPending}
              onClick={runImport}>
              {progress.done > 0
                ? `Resume — ${built.rows.length - progress.done} left`
                : `Import ${built.rows.length} service${built.rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {phase === "importing" && (
        <p className="muted" style={{ fontSize: "var(--type-md)", padding: "var(--space-6) 0" }}>
          Importing… {progress.done > 0 ? `${progress.done} of ${built?.rows.length ?? 0}` : "hang tight"}
        </p>
      )}

      {phase === "done" && summary && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "var(--space-4) 0 var(--space-1)" }}>
          <div style={{
            width: 46, height: 46, borderRadius: "var(--radius-pill)", background: "var(--green-100)",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "var(--space-3)",
          }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--ink)"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{ fontWeight: 800, fontSize: "var(--type-lg)" }}>
            {summary.created} service{summary.created === 1 ? "" : "s"} added
          </div>
          {(summary.deduped > 0 || summary.failed > 0) && (
            <div className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)" }}>
              {summary.deduped > 0 && `${summary.deduped} already in your book`}
              {summary.deduped > 0 && summary.failed > 0 && " · "}
              {summary.failed > 0 && `${summary.failed} couldn’t be read`}
            </div>
          )}
          <button type="button" className="btn primary" style={{ marginTop: "var(--space-5)" }} onClick={close}>Done</button>
        </div>
      )}
    </div>
  );
}
