"use client";

/**
 * components/shared/staged-attachment.tsx
 * Attaching a file on a form that has nothing to attach it TO yet.
 *
 * Both creation modals hit the same wall: the upload endpoints mint a signed URL scoped to a
 * record ("<org>/leads/<leadId>/…", "<org>/jobs/<jobId>/…"), so there is nowhere to put the bytes
 * until the customer or the job exists. The file is therefore held in memory and uploaded AFTER
 * the create resolves, by the caller, which is the only party that knows the new id.
 *
 * VALIDATION HAPPENS AT PICK TIME, not at upload time. The uploaders check extension and size too
 * — they must, they are the boundary — but by then the record has been created and the office is
 * looking at a closed modal. Refusing a 30 MB .svg the moment it is chosen is the difference
 * between "that file won't work" and "your customer saved but their photo vanished".
 *
 * The allowed set is derived from NOTE_ATTACH_ACCEPT rather than retyped, so it cannot drift from
 * what the server admits.
 */

import { useCallback, useState } from "react";
import { AttachControl, StagedFileChip } from "./note-composer";
import { NOTE_ATTACH_ACCEPT } from "@/lib/store/upload-lead-note-file";
import { MAX_FILE_BYTES, UnsupportedFileError, FileTooLargeError } from "@/lib/store/upload-job-file";

/** Turn an upload failure into a line that names the rule the file broke. */
export function attachErrorMessage(err: unknown): string {
  if (err instanceof UnsupportedFileError) return `Can't attach a .${err.ext} file.`;
  if (err instanceof FileTooLargeError) return "That file is over 10 MB.";
  return "That didn't upload — try again.";
}

/** The extensions NOTE_ATTACH_ACCEPT admits, as a set — ".pdf,.csv" → {pdf, csv}. */
const ALLOWED_EXTS = new Set(
  NOTE_ATTACH_ACCEPT.split(",").map((e) => e.trim().replace(/^\./, "").toLowerCase()),
);

const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";

export interface StagedAttachment {
  /** The chosen file, or null. Hand this to an uploader once the record exists. */
  readonly file: File | null;
  /** Its name, for the control's label. */
  readonly name: string | null;
  /** Why the last pick was refused, or null. Also settable by the caller after a failed upload. */
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
  readonly pick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly clear: () => void;
}

export function useStagedAttachment(): StagedAttachment {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Reset the input so choosing the SAME file twice still fires a change event — otherwise a
    // pick that was refused cannot be retried after the file is edited on disk.
    e.target.value = "";
    if (!picked) return;

    const ext = extOf(picked.name);
    if (!ALLOWED_EXTS.has(ext)) {
      setFile(null);
      setError(`Can't attach a .${ext || "unknown"} file.`);
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setFile(null);
      setError("That file is over 10 MB.");
      return;
    }
    setError(null);
    setFile(picked);
  }, []);

  const clear = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  return { file, name: file?.name ?? null, error, setError, pick, clear };
}

/**
 * The pick button, for placing INSIDE the field's row (see AttachControl's note on why).
 *
 * `busy` is the FORM's in-flight state, not an upload's: the upload happens after submit, so the
 * only moment this control should refuse a press is while the create it belongs to is running.
 */
export function StagedAttachButton({
  staged,
  busy,
}: {
  readonly staged: StagedAttachment;
  readonly busy?: boolean;
}) {
  return (
    <AttachControl
      accept={NOTE_ATTACH_ACCEPT}
      busy={Boolean(busy)}
      name={staged.name}
      onPick={staged.pick}
    />
  );
}

/**
 * What is staged, and why a pick was refused — the two things that belong BELOW the row.
 *
 * Renders nothing at all when there is neither, so a form with no attachment is exactly the form
 * it was before this existed. That is what stops the affordance from costing vertical space it has
 * not earned.
 */
export function StagedAttachStatus({ staged }: { readonly staged: StagedAttachment }) {
  if (!staged.name && !staged.error) return null;
  return (
    <>
      {staged.name ? <StagedFileChip name={staged.name} onRemove={staged.clear} /> : null}
      {staged.error ? (
        <div
          role="alert"
          style={{ color: "var(--red-700)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}
        >
          {staged.error}
        </div>
      ) : null}
    </>
  );
}
