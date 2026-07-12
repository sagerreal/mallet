"use client";

/**
 * Import customers from a CSV exported by ANY system (QuickBooks, Google Contacts,
 * Jobber, a spreadsheet). Parses + maps + validates entirely in the browser and
 * sends clean rows to v1.customers.importCustomers in ≤500-row chunks. Dedupe by
 * phone is handled server-side. No file touches the server.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { parseCsv } from "@/lib/import/parse-csv";
import { autoMap, buildImportRows, type MappingConfig, type BuildResult } from "@/lib/import/map-rows";

const CHUNK = 500;
const TARGETS: { key: keyof Omit<MappingConfig, "sourceTag">; label: string }[] = [
  { key: "name", label: "Name (or first name)" },
  { key: "lastName", label: "Last name (optional)" },
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
  const importMut = api.v1.customers.importCustomers.useMutation();

  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<MappingConfig | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState(ZERO);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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

  return (
    <div className="import-modal" style={{ minWidth: 380, maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Import customers</h2>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Upload a CSV from anywhere — QuickBooks, Google Contacts, Jobber, or a spreadsheet.
            Export a CSV from that tool and drop it here.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          {error && <p className="auth-error" style={{ marginTop: 12 }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>Match your columns to Mallet fields:</p>
          <div style={{ display: "grid", gap: 8 }}>
            {TARGETS.map((t) => (
              <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 150, fontSize: 13 }}>{t.label}</span>
                <select value={map[t.key] ?? ""} onChange={(e) => setField(t.key, e.target.value)}
                  style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 13 }}>
                  <option value="">— none —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 150, fontSize: 13 }}>Tag source as</span>
              <input value={map.sourceTag} maxLength={255} onChange={(e) => { setMap((m) => m ? { ...m, sourceTag: e.target.value } : m); setProgress(ZERO); }}
                style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 13 }} />
            </label>
          </div>

          <div className="muted" style={{ fontSize: 13, margin: "14px 0" }}>
            <b>{built.rows.length} ready</b>
            {built.skipped.length > 0 && ` · ${built.skipped.length} skipped (no name)`}
            {built.warnings.length > 0 && ` · ${built.warnings.length} warnings`}
          </div>

          {error && <p className="auth-error">{error}</p>}
          <button
            className="btn primary"
            disabled={built.rows.length === 0 || importMut.isPending}
            onClick={runImport}
          >
            {progress.done > 0
              ? `Resume — ${built.rows.length - progress.done} left`
              : `Import ${built.rows.length} customer${built.rows.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {phase === "importing" && <p className="muted">Importing…</p>}

      {phase === "done" && summary && (
        <>
          <p style={{ fontWeight: 700 }}>Done.</p>
          <p className="muted" style={{ fontSize: 13 }}>
            {summary.created} added
            {summary.deduped > 0 && ` · ${summary.deduped} already existed`}
            {summary.failed > 0 && ` · ${summary.failed} failed`}.
          </p>
        </>
      )}
    </div>
  );
}
