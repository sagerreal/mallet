"use client";

/**
 * The generic import modal. One flow — upload → map → importing → done — driven by an
 * ImportDescriptor, so every entity gets the same experience and the chunking/resume logic exists
 * once instead of per entity.
 *
 * Everything a specific entity needs beyond its descriptor (the wording, and how to send a chunk)
 * arrives through props. Parsing, mapping and validation all happen in the BROWSER; no customer
 * file ever reaches our server.
 */

import { useState } from "react";
import { useCloseModal } from "@/lib/store/app-store";
import { parseCsv } from "@/lib/import/parse-csv";
import { importErrorMessage } from "@/lib/import/import-error-message";
import { autoMap } from "@/lib/import/engine/auto-map";
import { buildRows } from "@/lib/import/engine/build-rows";
import type { BuildResult, BuiltRow, ImportDescriptor, MappingConfig } from "@/lib/import/engine/descriptor";
import { CsvDropzone, ImportingLine, ImportDoneCard } from "./import-shared";
import { ImportMappingStep } from "./import-mapping-step";
import { ImportPreviewStep } from "./import-preview-step";

/** What the server reports back for one chunk. Identical across entities. */
export interface ChunkResult {
  created: number;
  /** Matched an existing record and PATCHED it (services re-import). */
  updated?: number;
  /** Matched an existing record and left it alone (customers). */
  deduped: number;
  failed: number;
}

export interface ImportModalCopy {
  /** Sheet title, e.g. "Import customers". */
  readonly title: string;
  /** Shown above the dropzone — name the tools a shop is likely exporting from. */
  readonly uploadHint: string;
  /** Reason rows get skipped, shown on the skipped pill ("no name"). */
  readonly skipReason: string;
  /** Primary button + done headline, e.g. (n) => `${n} customers added`. */
  readonly importLabel: (count: number) => string;
  readonly doneHeadline: (created: number) => string;
  /** Phrase for rows the server matched to something existing. */
  readonly dedupedLabel: (n: number) => string;
}

interface Props {
  readonly descriptor: ImportDescriptor;
  readonly copy: ImportModalCopy;
  /** Sends one chunk. The caller owns the tRPC mutation so this file stays transport-agnostic. */
  readonly sendChunk: (rows: BuiltRow[]) => Promise<ChunkResult>;
  /** Refreshes the caller's queries after each chunk, so the list fills in progressively. */
  readonly onChunkDone: () => Promise<unknown>;
  readonly isPending: boolean;
  /**
   * How many of the built rows will overwrite an existing record, for entities that re-import.
   * The caller owns this because only it knows the entity's match key. Omitted → create-only.
   */
  readonly countUpdates?: (rows: readonly BuiltRow[]) => number;
}

type Phase = "upload" | "map" | "preview" | "importing" | "done";

/**
 * Committed-offset progress. `done` counts rows already sent AND acknowledged, so a retry resumes
 * from there rather than re-sending committed rows — server dedupe cannot be assumed for every
 * entity, so a re-sent row could be created AGAIN as a duplicate. Reset to ZERO whenever the file
 * or the mapping changes, since `done` only ever indexes into the CURRENT rows.
 */
const ZERO = { done: 0, created: 0, updated: 0, deduped: 0, failed: 0 };

/**
 * The line under the done headline, which reports only what actually happened. An import that
 * refreshed 88 existing services has to SAY so — "412 added" alone hides the fact that records
 * were overwritten.
 */
function buildDoneSub(summary: ChunkResult, copy: ImportModalCopy): React.ReactNode {
  const parts: string[] = [];
  if (summary.updated && summary.updated > 0) {
    parts.push(`${summary.updated} updated`);
  }
  if (summary.deduped > 0) parts.push(copy.dedupedLabel(summary.deduped));
  if (summary.failed > 0) parts.push(`${summary.failed} couldn’t be read`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function ImportModal({ descriptor, copy, sendChunk, onChunkDone, isPending, countUpdates }: Props) {
  const close = useCloseModal();

  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<MappingConfig | null>(null);
  const [summary, setSummary] = useState<ChunkResult | null>(null);
  const [progress, setProgress] = useState(ZERO);

  async function processFile(file: File) {
    setError(null);
    try {
      const { headers: h, records: r } = await parseCsv(file);
      setHeaders(h);
      setRecords(r);
      setMap(autoMap(h, descriptor));
      setProgress(ZERO); // new file → the committed offset is meaningless; start fresh
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

  const built: BuildResult | null = map ? buildRows(records, map, descriptor) : null;

  async function runImport() {
    if (!built) return;
    setPhase("importing");
    setError(null);
    let { done, created, updated, deduped, failed } = progress;
    try {
      // Resume from the committed offset; a retry after a mid-batch failure must not re-send
      // already-created rows.
      for (let i = done; i < built.rows.length; i += descriptor.chunkSize) {
        const res = await sendChunk(built.rows.slice(i, i + descriptor.chunkSize));
        created += res.created;
        updated += res.updated ?? 0;
        deduped += res.deduped;
        failed += res.failed;
        done = Math.min(i + descriptor.chunkSize, built.rows.length);
        setProgress({ done, created, updated, deduped, failed });
        await onChunkDone(); // refresh after each chunk, not only at the end
      }
      setSummary({ created, updated, deduped, failed });
      setPhase("done");
    } catch (err) {
      setProgress({ done, created, updated, deduped, failed }); // persist so a retry RESUMES, not re-sends
      // Not err.message raw: a tRPC input rejection carries the serialized Zod issue array as
      // its message, which is how a blank price cell put a wall of JSON on screen.
      setError(importErrorMessage(err));
      // Back to the preview, not the mapping: the offset is still valid, so the primary action
      // reads "Resume — N left" and picks up where it stopped.
      setPhase("preview");
    }
  }

  function setField(key: string, value: string) {
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
        <h2>{copy.title}</h2>
      </div>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-5)" }}>
            {copy.uploadHint}
          </p>

          <CsvDropzone dragging={dragging} setDragging={setDragging} onDrop={onDrop} onFile={onFile} />

          {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <ImportMappingStep
          descriptor={descriptor}
          headers={headers}
          mapping={map}
          built={built}
          skipReason={copy.skipReason}
          busy={isPending}
          error={error}
          onSetField={setField}
          onBack={reset}
          onImport={() => { setError(null); setPhase("preview"); }}
        />
      )}

      {phase === "preview" && built && (
        <ImportPreviewStep
          built={built}
          skipReason={copy.skipReason}
          importLabel={copy.importLabel}
          resumeFrom={progress.done}
          busy={isPending}
          error={error}
          willUpdate={countUpdates ? countUpdates(built.rows) : undefined}
          onBack={() => { setError(null); setPhase("map"); }}
          onConfirm={runImport}
        />
      )}

      {phase === "importing" && <ImportingLine done={progress.done} total={built?.rows.length ?? 0} />}

      {phase === "done" && summary && (
        <ImportDoneCard
          headline={copy.doneHeadline(summary.created)}
          sub={buildDoneSub(summary, copy)}
          onClose={close}
        />
      )}
    </div>
  );
}
