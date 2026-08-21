"use client";

/**
 * components/modals/job-files.tsx
 * "Files" — the documents on a job. A permit, a spec sheet, a supplier receipt.
 *
 * IT SITS INSIDE THE JOB NOTES ROW, not a row of its own: a file and the sentence explaining it
 * belong together, and two rows put them a scroll apart.
 *
 * Documents are still kept apart from PHOTOS in the store — a photo is looked at, a document is
 * opened, and `Job.photos` is a bare string[] with nowhere to put a filename. Same table
 * server-side, split on mime at the mapper. What is shared is the ROW they appear in, not the list.
 */

import { useRef, useState } from "react";
import type { JobFile } from "@/lib/store/types";
import { uploadJobFile, UnsupportedFileError, FileTooLargeError } from "@/lib/store/upload-job-file";

const note = { fontSize: "var(--type-sm)", color: "var(--ink-2)" } as const;

/** A PDF and a spreadsheet read differently at a glance; the extension is the cheapest signal. */
const badge = (f: JobFile): string => {
  const dot = f.name.lastIndexOf(".");
  const ext = dot >= 0 ? f.name.slice(dot + 1).toUpperCase() : "";
  return ext.length > 0 && ext.length <= 4 ? ext : "FILE";
};

export function JobFilesBody({
  jobId,
  files,
  onUploaded,
  readOnly,
}: {
  jobId: string;
  files: readonly JobFile[];
  onUploaded: () => void;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first so re-picking the SAME file still fires a change event.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await uploadJobFile(jobId, file);
      onUploaded();
    } catch (err: unknown) {
      // Say which rule the file broke — "couldn't upload" leaves someone retrying a file that
      // will never be accepted.
      if (err instanceof UnsupportedFileError) setError(`Can't attach a .${err.ext} file.`);
      else if (err instanceof FileTooLargeError) setError("That file is over 10 MB.");
      else setError("That didn't upload — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {files.length === 0 && <p style={{ ...note, margin: 0 }}>Attach a permit, a spec sheet, a receipt.</p>}

      {files.map((f) => (
        <div key={f.id} style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
          <span className="pill" style={{ fontSize: "var(--type-xs)", flex: "none" }}>{badge(f)}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.name}
          </span>
          {f.caption && <span style={note}>{f.caption}</span>}
        </div>
      ))}

      {!readOnly && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic"
            style={{ display: "none" }}
            onChange={pick}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className="btn sm"
            style={{ alignSelf: "flex-start" }}
            aria-disabled={busy ? true : undefined}
            onClick={(e) => {
              if (busy) {
                e.preventDefault();
                return;
              }
              inputRef.current?.click();
            }}
          >
            {busy ? "Attaching…" : "Attach a file"}
          </button>
        </>
      )}

      {error && (
        <p style={{ ...note, color: "var(--red)", margin: 0 }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
