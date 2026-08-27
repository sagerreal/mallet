"use client";

/**
 * components/shared/note-composer.tsx
 * The one note composer. Extracted from the customer sheet's Notes body so the job sheet
 * can use the same control rather than growing a second, subtly different one.
 *
 * It owns the input and nothing else — no store, no lead, no job. The caller says what
 * happens on submit and gets told whether it worked, which is what let the same component
 * serve a customer note (optimistic store action, resolves immediately) and a job note
 * (a real await on the server) without either surface knowing about the other.
 *
 * FAILURE PUTS THE TEXT BACK. The customer composer cleared the field and rolled the store
 * back silently, so a failed save looked exactly like a successful one and the sentence the
 * office typed was gone. The tech feed already restored the text and named the failure; this
 * makes that the behaviour everywhere.
 *
 * A NOTE MAY CARRY ONE FILE, and only where the caller passes `onAttachFile` — every other
 * surface renders exactly as it did before. The file is uploaded when it is PICKED, not when
 * the note is submitted: the caller holds the stored reference and puts it on the note it
 * writes, so a photo and the sentence explaining it stay one entry. Which is also why a
 * submit with a staged file and no text goes through — a photo of a panel label is a whole
 * note on its own, and making someone type a word first would only get them to type a dot.
 */

import { useState, useEffect, useRef } from "react";

/**
 * The attach affordance — a hidden file input driven by a visible button, the same grammar
 * job-files.tsx uses. Presentational only: it does not know what happens to the file, which is
 * what keeps the composer's one attach path in one place above.
 *
 * EXPORTED so the creation modals can reuse it. They cannot use the composer itself — there is no
 * record to hang a note on until the form is submitted — but the control the office presses must
 * be the same one, or "Attach a file" means two different-looking things on two screens.
 */
export function AttachControl({
  accept,
  busy,
  name,
  onPick,
}: {
  accept?: string;
  busy: boolean;
  /** The staged file's name, once one is stored. */
  name: string | null;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "var(--space-2)",
        marginTop: "var(--space-2)",
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => void onPick(e)}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="btn sm"
        aria-disabled={busy ? true : undefined}
        onClick={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          fileRef.current?.click();
        }}
      >
        {busy ? "Attaching…" : name ? "Replace the file" : "Attach a file"}
      </button>
      {name && (
        <span
          style={{
            fontSize: "var(--type-sm)",
            color: "var(--ink-2)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

/**
 * The file staged for the next note: picked, uploaded by the caller, and held by NAME only —
 * where the bytes went is the caller's business, and the composer deliberately never learns it.
 *
 * Failures are reported outward rather than kept here, so the composer shows ONE error line: a
 * rejected file and a failed save are both "the thing you just tried didn't happen", and two
 * alerts stacked under a one-line composer is noise.
 */
function useStagedAttachment(
  onAttachFile: ((file: File) => Promise<void>) | undefined,
  onError: (message: string | null) => void,
) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first so re-picking the SAME file still fires a change event.
    e.target.value = "";
    if (!file || !onAttachFile) return;
    // A stale failure line must not survive the next attempt.
    onError(null);
    setBusy(true);
    try {
      await onAttachFile(file);
      setName(file.name);
    } catch (err: unknown) {
      // The caller's message names the actual rule the file broke; "that didn't work" would
      // leave someone retrying a file that will never be accepted.
      onError(err instanceof Error && err.message ? err.message : "That didn't attach — try again.");
    } finally {
      setBusy(false);
    }
  }

  return { name, busy, pick, clear: () => setName(null) };
}

interface NoteComposerProps {
  placeholder: string;
  buttonLabel?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Renders the composer read-only with a reason in place of the input. */
  disabled?: string | false;
  /**
   * Save the note. Return false (or throw) and the text is put back in the field.
   * Sync callers may return void — a store action that resolves optimistically counts
   * as success, which is how the customer sheet keeps its instant feel.
   *
   * Called with an EMPTY string when the only thing being added is an attachment.
   */
  onSubmit: (text: string) => void | boolean | Promise<void | boolean>;
  /**
   * Store one picked file and keep the reference — the composer never sees where it went.
   * OMIT IT and no attach affordance renders at all; that is the default, and every surface
   * that passes nothing looks and behaves exactly as it did before this existed.
   *
   * THROW AN ERROR WHOSE MESSAGE IS ALREADY FIT TO READ. It is shown verbatim: this component
   * cannot tell a rejected file type from a dropped connection, and the caller can. Anything
   * thrown without a message falls back to a generic line rather than showing nothing.
   */
  onAttachFile?: (file: File) => Promise<void>;
  /** The file picker's filter, e.g. ".pdf,.jpg". Only meaningful with onAttachFile. */
  attachAccept?: string;
}

export function NoteComposer({
  placeholder,
  buttonLabel = "Add note",
  ariaLabel = "Add a note",
  autoFocus,
  disabled,
  onSubmit,
  onAttachFile,
  attachAccept,
}: NoteComposerProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachment = useStagedAttachment(onAttachFile, setError);
  const { name: attachedName, busy: attaching } = attachment;

  // One tap + type: expanding the row focuses the composer, so logging a gate code
  // costs a single tap.
  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  async function submit() {
    const t = text.trim();
    // An attachment with no sentence is a real note; nothing at all is not.
    if ((!t && !attachedName) || saving || attaching || disabled) return;
    setError(null);
    setText("");
    setSaving(true);
    try {
      const ok = await onSubmit(t);
      if (ok === false) {
        setText(t);
        setError("Couldn't save the note — try again.");
      } else {
        // The file rode the note; the next one starts empty.
        attachment.clear();
      }
    } catch {
      // The staged file is deliberately KEPT: it is already in storage, and a retry should
      // carry it rather than make someone pick it a second time.
      setText(t);
      setError("Couldn't save the note — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
        {disabled}
      </p>
    );
  }

  const canSubmit = (text.trim().length > 0 || attachedName !== null) && !saving && !attaching;

  return (
    <>
      <div className="cfrow" style={{ marginTop: 0 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          aria-label={ariaLabel}
        />
        <button className="btn" onClick={() => void submit()} disabled={!canSubmit}>
          {saving ? "Saving…" : buttonLabel}
        </button>
      </div>

      {onAttachFile && (
        <AttachControl accept={attachAccept} busy={attaching} name={attachedName} onPick={attachment.pick} />
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {error}
        </p>
      )}
    </>
  );
}
