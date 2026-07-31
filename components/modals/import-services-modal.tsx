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
import { ImportPill, IMPORT_SELECT_STYLE, CsvDropzone, ImportingLine, ImportDoneCard } from "./import-shared";
import { SelectMenu } from "@/components/ui/select-menu";

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
      <div className="sheet-head">
        <h2>Import price book</h2>
      </div>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
            Bring in your price book from Housecall Pro, Jobber, ServiceTitan, or a spreadsheet —
            export a CSV and drop it here.
          </p>

          <CsvDropzone dragging={dragging} setDragging={setDragging} onDrop={onDrop} onFile={onFile} />

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-1)" }}>
            We matched your columns to Elas fields — adjust any that look wrong.
          </p>

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", margin: "var(--space-3) 0 var(--space-3)" }}>
            <ImportPill tone="ready" label={`${built.rows.length} ready`} />
            {built.skipped.length > 0 && <ImportPill tone="skipped" label={`${built.skipped.length} skipped — no name`} />}
            {built.warnings.length > 0 && <ImportPill tone="warn" label={`${built.warnings.length} imported at $0`} />}
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
              <div key={t.key} style={{
                display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)",
                borderTop: i === 0 ? "none" : "1px solid var(--manila-line)",
              }}>
                <span style={{ width: 96, fontSize: "var(--type-base)", fontWeight: 700, color: "var(--ink-2)" }}>{t.label}</span>
                <SelectMenu
                  value={map[t.key] ?? ""}
                  onChange={(v) => setField(t.key, v)}
                  options={[{ value: "", label: "— skip —" }, ...headers.map((h) => ({ value: h, label: h }))]}
                  // Same words as the visible span beside it, so the accessible name and the
                  // on-screen name agree. These rows are generated in a map, so a per-row
                  // useFieldId is not available without extracting a component.
                  aria-label={t.label}
                  style={IMPORT_SELECT_STYLE}
                  compact
                />
              </div>
            ))}
          </div>

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}
        </>
      )}

      {phase === "importing" && (
        <ImportingLine done={progress.done} total={built?.rows.length ?? 0} />
      )}

      {phase === "done" && summary && (
        <ImportDoneCard
          headline={`${summary.created} service${summary.created === 1 ? "" : "s"} added`}
          sub={
            summary.deduped > 0 || summary.failed > 0 ? (
              <>
                {summary.deduped > 0 && `${summary.deduped} already in your book`}
                {summary.deduped > 0 && summary.failed > 0 && " · "}
                {summary.failed > 0 && `${summary.failed} couldn’t be read`}
              </>
            ) : undefined
          }
          onClose={close}
        />
      )}

      {/* Step-terminal action docked in the thumb zone — only the map step has one.
          Upload/importing/done have no single confirm, so the foot stays absent there. */}
      {phase === "map" && built && (
        <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <button type="button" className="btn ghost" onClick={reset}>← Choose a different file</button>
          <button
            type="button"
            className="sheet-pri"
            style={{ flex: 1 }}
            disabled={built.rows.length === 0 || importMut.isPending}
            onClick={runImport}
          >
            {progress.done > 0
              ? `Resume — ${built.rows.length - progress.done} left`
              : `Import ${built.rows.length} service${built.rows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
