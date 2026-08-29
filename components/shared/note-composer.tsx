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

/** A paperclip, at the row's own text size. */
export function PaperclipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/**
 * The attach affordance — a hidden file input driven by a visible button, the same grammar
 * job-files.tsx uses. Presentational only: it does not know what happens to the file.
 *
 * AN ICON, AND IT BELONGS INSIDE THE INPUT'S ROW. This was a full-width-ish text button rendered
 * BELOW the composer, so every surface that turned attachments on grew an orphaned pill under the
 * field — and on the new-customer sheet it landed directly above "+ Add a custom field", making a
 * ragged stack of two mismatched buttons where the form should have ended. A secondary action on
 * the same note is a control in that note's row, not a row of its own.
 *
 * The filename is NOT in here: it is what made the button change width the moment a file was
 * picked. It renders as a StagedFileChip below the row instead, where it is information.
 */
export function AttachControl({
  accept,
  busy,
  name,
  onPick,
}: {
  accept?: string;
  busy: boolean;
  /** The staged file's name, once one is stored — used only for the accessible label. */
  name: string | null;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const label = busy ? "Attaching a file…" : name ? `Replace the attached file, ${name}` : "Attach a file";
  return (
    <>
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
        className={`attachbtn${name ? " on" : ""}`}
        aria-label={label}
        title={label}
        aria-disabled={busy ? true : undefined}
        onClick={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          fileRef.current?.click();
        }}
      >
        <PaperclipIcon />
      </button>
    </>
  );
}

/**
 * What is attached, once something is — a quiet line naming the file with a way to drop it.
 *
 * Information, not a control cluster: the name used to sit inside the attach button, which made
 * the button's width jump on pick and left nowhere to un-attach without replacing.
 */
export function StagedFileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <div className="attachchip">
      <PaperclipIcon size={14} />
      <span className="attachchip-n">{name}</span>
      {onRemove && (
        <button type="button" className="attachchip-x" aria-label={`Remove ${name}`} onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The composer's own staging: it uploads on PICK (the record already exists here), so it holds a
 * stored name rather than a File. Distinct from the creation modals' useStagedAttachment, which
 * cannot upload until its record has been created.
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
        {/* In the row, between the field and its action — see the note on AttachControl. */}
        {onAttachFile && (
          <AttachControl accept={attachAccept} busy={attaching} name={attachedName} onPick={attachment.pick} />
        )}
        <button className="btn" onClick={() => void submit()} disabled={!canSubmit}>
          {saving ? "Saving…" : buttonLabel}
        </button>
      </div>

      {attachedName && <StagedFileChip name={attachedName} onRemove={attachment.clear} />}

      {/* Class, not an inline font-size: an inline size wins over any external rule regardless of
          specificity, which is what made this line unreachable for a scope like .po-scope
          (app/prototype.css) that needs to lift text past this component's own default — the same
          reason select-menu.tsx moved its trigger caret's size onto a class. The class's own rule
          keeps every OTHER surface exactly as it was; only .po-scope overrides it. */}
      {error && (
        <p className="ncomposer-err" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
