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
import { uploadJobFile, UnsupportedFileError, FileTooLargeError, type UploadSurface } from "@/lib/store/upload-job-file";
import { trpcVanilla } from "@/lib/trpc/vanilla";

const note = { fontSize: "var(--type-sm)", color: "var(--ink-2)" } as const;

/** What v1.jobs.photoUploadUrl admits. Shared so a caller placing its own picker cannot drift. */
export const JOB_ATTACH_ACCEPT = ".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic";

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
  listOnly,
  surface = "office",
}: {
  jobId: string;
  files: readonly JobFile[];
  onUploaded: (file: JobFile) => void;
  readOnly?: boolean;
  /**
   * Render the LIST only — no attach control.
   *
   * For surfaces where attaching lives somewhere better: the office job sheet puts a paperclip
   * inside the note composer's row, so this component's own wide button would be a second attach
   * affordance sitting orphaned under it. The field sheet's Files section has no such row and
   * keeps the button, which is why this is opt-in rather than the default.
   */
  listOnly?: boolean;
  /** Which router to upload and view through — the field twin also gates on assignment. */
  surface?: UploadSurface;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  /**
   * OPEN THE ATTACHMENT. The bucket is private, so the name has to be exchanged for a
   * short-lived signed URL at click time — there is no durable link to render up front, and
   * minting one for every row on open would hand out URLs nobody asked for.
   *
   * The window is opened BEFORE the await and pointed afterwards: a popup blocker only trusts a
   * window created inside the click, and a tab opened after a network round trip is blocked.
   */
  async function openFile(id: string) {
    if (opening) return;
    setError(null);
    setOpening(id);
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const api = surface === "field" ? trpcVanilla.v1.field : trpcVanilla.v1.jobs;
      const { url } = await api.fileViewUrl.mutate({ jobId, id });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError("That file wouldn't open — try again.");
    } finally {
      setOpening(null);
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first so re-picking the SAME file still fires a change event.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onUploaded(await uploadJobFile(jobId, file, surface));
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
      {files.map((f) => (
        <div key={f.id} style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
          <span className="pill" style={{ fontSize: "var(--type-xs)", flex: "none" }}>{badge(f)}</span>
          <button
            type="button"
            className="linklike"
            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}
            onClick={() => void openFile(f.id)}
            aria-busy={opening === f.id ? true : undefined}
          >
            {opening === f.id ? "Opening…" : f.name}
          </button>
          {f.caption && <span style={note}>{f.caption}</span>}
        </div>
      ))}

      {!readOnly && !listOnly && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={JOB_ATTACH_ACCEPT}
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
