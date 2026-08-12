/**
 * components/modals/tech-job-modal/quote-tab.tsx
 * The Quote tab of the tech job view (estimating part 3) — the field half of
 * the quoting split, top to bottom:
 *
 *   1. SCOPE — what the tech saw: the visit's scope notes (tap → edit in-flow;
 *      saves through v1.field.setVisitNotes — the SAME visit-notes column the
 *      office pipeline's "quote it ›" card reads via scopedEstimateVisit, so a
 *      saved scope lights up the office Quoting lane with zero pipeline work),
 *      the job's photo strip (uploadFieldPhoto — the copilot's capture path),
 *      and a "Scan a room" row unless the org's settings have arrived and said
 *      this shop does not measure. That row renders on EVERY device and on a
 *      CLOSED job: live when this one can scan, disabled-with-its-reason when it
 *      cannot (no LiDAR, a browser rather than the iPhone app, a job that is
 *      done, or a settings read that never landed) — see
 *      components/shared/scan-unavailable.
 *   2. On an ESTIMATE visit: the dual exit — "Quote it now" (reveals the same
 *      builder + present flow the repair path uses) or "Send scope to the
 *      office" (the notes write IS the handoff; sent-ness is DERIVED from the
 *      visit carrying scope notes — no new status).
 *   3. THE PRICE — the TechQuoteBuilder embedded in-flow (lines list, + From
 *      pricebook, Good & Best opt-in) with "Present to customer →" as the
 *      tab's sticky primary, then the existing present → Approve & sign flow
 *      (estimate-backed since part 1). While the builder is in present/sign
 *      (the phone is in the customer's hand), the Scope section hides.
 *
 * The tab owns its .sheet-foot: the host modal suppresses its own foot while
 * this tab is active so the sheet always has exactly ONE primary.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { useAppStore, usePushModal, useCloseModal } from "@/lib/store/app-store";
import { fmt$2 } from "@/lib/format";
import { MODAL } from "@/lib/store/modal-ids";
import { useRoomScanAvailability } from "@/lib/native/room-scan";
import { ScanUnavailable, type ScanBlocker } from "@/components/shared/scan-unavailable";
import { measurementSurfacesVisible } from "@/lib/measurement-gate";
import { useMeasurementGate } from "@/features/settings/measurement-gate-provider";
import { downscaleImage } from "@/lib/images/downscale";
import { uploadFieldPhoto } from "@/lib/store/upload-field-photo";
import { TechQuoteBuilder, type TechQuoteMode } from "@/components/modals/pricing/tech-quote-builder";
import { SignedRecordRow } from "@/components/modals/pricing/signed-record-row";
import { jobPriceCommitted } from "@/features/jobs/job-status-meta";
import { SheetRow } from "@/components/modals/sheet-row";
import type { Job, Visit } from "@/lib/store/types";
import { jobMode, jobQuoted, AO_INPUT } from "./helpers";

const SCOPE_SAVE_FAILED_COPY = "Couldn't save the scope — try again.";
const SCOPE_EMPTY_SEND_COPY = "Write what you saw first — the office quotes from your notes.";
const PHOTO_UPLOAD_FAILED_COPY = "Photo upload failed — try again.";

// ---------------------------------------------------------------------------
// Scope notes row — the visit's scope notes, tap → edit in-flow (no floating
// UI), Save persists via setVisitNotes. Exported state predicate lives on the
// tab (sentToOffice) so the dual exit and this row can never disagree.
// ---------------------------------------------------------------------------

interface ScopeNotesRowProps {
  scopeNotes: string;
  disabled: boolean;
  /** Bumped by the host to force the editor open (the dual exit's "nothing to send" path). */
  openSignal?: number;
  onSave: (notes: string) => Promise<{ ok: boolean; error?: string }>;
}

function ScopeNotesRow({ scopeNotes, disabled, openSignal = 0, onSave }: ScopeNotesRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Host-forced open: "Send scope to the office" with nothing written lands the
  // tech in the editor instead of at a dead error. Initialized to ZERO, not the current
  // signal: the editor now lives inside the Scope row's accordion, whose body mounts on
  // open — a signal bumped in the same commit that opens the row must still land here.
  const lastSignal = useRef(0);
  if (openSignal !== lastSignal.current) {
    lastSignal.current = openSignal;
    if (!disabled && !editing) {
      setDraft(scopeNotes);
      setError("");
      setEditing(true);
    }
  }

  function open() {
    if (disabled) return;
    setDraft(scopeNotes);
    setError("");
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    const { ok, error: serverError } = await onSave(draft);
    setSaving(false);
    if (!ok) {
      setError(serverError ?? SCOPE_SAVE_FAILED_COPY);
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="jaddr"
        onClick={open}
        disabled={disabled}
        style={{ width: "100%", textAlign: "left" }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-line" }}>
          {scopeNotes || <span className="muted">What you saw on site — sizes, access, materials.</span>}
        </span>
        {!disabled && <span className="nav">{scopeNotes ? "Edit →" : "Write →"}</span>}
      </button>
    );
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError("");
        }}
        rows={4}
        maxLength={2000}
        autoFocus
        disabled={saving}
        aria-label="Scope notes"
        placeholder="What you saw on site — sizes, access, materials."
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", ...AO_INPUT }}
      />
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <button className="btn sm primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save scope"}
        </button>
        <button className="btn sm ghost" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo strip — the job's photos as chips (paths are storage keys, not public
// URLs — the strip is a count-and-capture surface, same as the copilot's photo
// chips) + the camera capture path the copilot already uses.
// ---------------------------------------------------------------------------

function ScopePhotos({ job, disabled }: { job: Job; disabled: boolean }) {
  const adoptJobPhotoPath = useAppStore((s) => s.adoptJobPhotoPath);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const photos = job.photos ?? [];

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!file) return;
      setError("");
      setUploading(true);
      try {
        const blob = await downscaleImage(file);
        const objectId = await uploadFieldPhoto(job.id, blob);
        // uploadFieldPhoto persisted the row; keep the store strip in step.
        adoptJobPhotoPath(job.id, objectId);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : PHOTO_UPLOAD_FAILED_COPY);
      } finally {
        setUploading(false);
      }
    },
    [job.id, adoptJobPhotoPath],
  );

  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {photos.map((_, i) => (
          <span key={i} className="cp-chip">
            Photo {i + 1}
          </span>
        ))}
        {!disabled && (
          <button
            type="button"
            className="btn sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "📷 Add photo"}
          </button>
        )}
        {photos.length === 0 && disabled && (
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            No photos on this job.
          </span>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        aria-label="Add a job photo"
        onChange={(e) => void handleFileChange(e)}
      />
      {error && (
        <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export interface QuoteTabProps {
  job: Job;
  /** The visit the scope belongs to — the viewer's own visit (resolved by the host). */
  scopeVisit: Visit | undefined;
  /** The job is closed — scope and price become read-only (server refuses writes anyway). */
  readOnly: boolean;
  /**
   * Called after the customer signs, and by nothing else — passed straight through to the
   * builder, whose whole contract is that the HOST decides where a sold quote lands. This tab
   * used to hand it `close`, which dismissed the technician out of the job at the exact moment
   * the work became his to do. Not the same action as the fallback Done below, which really does
   * mean "leave".
   */
  onSigned: () => void;
}

export function QuoteTab({ job, scopeVisit, readOnly, onSigned }: QuoteTabProps) {
  const setVisitNotes = useAppStore((s) => s.setVisitNotes);
  const measurementGate = useMeasurementGate();
  const pushModal = usePushModal();
  const close = useCloseModal();
  const scan = useRoomScanAvailability();

  // What is in the way of a live scan, or null if nothing is.
  //
  // DEVICE first: on a desktop browser "open the iPhone app" is the true and useful sentence
  // whatever else is going on, and it is the most fundamental fact of the three.
  //
  // Then the SETTINGS gate, ahead of the job's own state. `"unknown"` fails OPEN so the row is
  // never silently deleted by a failed read (lib/measurement-gate.ts) — but open means visible,
  // not live: this button opens the room card, which creates an estimate job server-side, and a
  // shop that turned measuring off on purpose must not get rows written into it because a settings
  // read 500'd. It sits ahead of `job-closed` because reopening the job would not make the scan
  // work while the gate is unknown, and a next step that does not unblock anything is not one.
  const scanBlocker: ScanBlocker | null =
    scan.status !== "ready"
      ? { kind: "device", availability: scan }
      : measurementGate === "unknown"
        ? { kind: "settings-unknown" }
        : readOnly
          ? { kind: "job-closed" }
          : null;

  const isEstimate = jobMode(job) === "estimate";
  const quoted = jobQuoted(job);
  // The price is COMMITTED — booked by the office or signed by the customer. The builder
  // renders its committed read-back + change-order surface, never an editable draft.
  const committed = jobPriceCommitted(job);

  // The dual exit's reveal (estimate visits only), THREE-STATE: null derives from the job
  // (a resumed draft with priced lines lands in the builder), true/false record an explicit
  // choice. It was a one-way boolean — "Quote it now" flipped it and nothing ever unset it,
  // so the chooser (and the send-scope path with it) was unreachable without closing the
  // sheet (Owen, Aug 11: "no back button when I hit quote it now").
  const [choosing, setChoosing] = useState<boolean | null>(null);
  const [builderMode, setBuilderMode] = useState<TechQuoteMode>("edit");
  const [sendError, setSendError] = useState("");
  const [scopeOpenSignal, setScopeOpenSignal] = useState(0);
  // The Scope row's accordion — controlled so "Send scope" with nothing written can open it.
  const [scopeRowOpen, setScopeRowOpen] = useState(false);

  // `committed` is listed on its own: a booked job on a price-redacted device reads null
  // rates, so `quoted` (which sums them) misses it and the tab would offer an editable draft
  // over a price the office already booked. An explicit Back (choosing === true) outranks a
  // resumed draft; a committed price outranks everything — its builder is the standing surface.
  const showBuilder = !isEstimate || committed || (choosing === null ? quoted : !choosing);
  // Back to the chooser exists only where the chooser exists: an uncommitted estimate.
  const canGoBack = isEstimate && !committed && showBuilder;
  // Sent-ness is DERIVED: the visit carrying scope notes IS the handoff record.
  const sentToOffice = Boolean(scopeVisit?.scopeNotes?.trim());

  const saveScope = useCallback(
    async (notes: string) => {
      if (!scopeVisit) {
        return { ok: false, error: "No visit on this job yet — the office schedules one first." };
      }
      const result = await setVisitNotes(job.id, scopeVisit.id, notes);
      if (result.ok) setSendError("");
      return result;
    },
    [job.id, scopeVisit, setVisitNotes],
  );

  // "Send scope to the office" — the saved notes ARE the handoff (sent-ness derives from
  // them), so with nothing written there is nothing to send: name the real problem and put
  // the tech in the editor. Once notes exist this button is replaced by the ✓ Sent state.
  function sendToOffice() {
    if (!sentToOffice) {
      setSendError(SCOPE_EMPTY_SEND_COPY);
      setScopeRowOpen(true);
      setScopeOpenSignal((n) => n + 1);
      return;
    }
    setSendError("");
  }

  // Present/sign = the phone is in the customer's hand — only the builder shows.
  const presenting = showBuilder && builderMode !== "edit";

  return (
    <>
      {/* Estimate visit, not yet quoting: the dual exit. */}
      {!presenting && isEstimate && !showBuilder && (
        <div className="fsec">
          <div className="fsec-h">
            <span>Next</span>
          </div>
          {sentToOffice ? (
            <div
              className="muted"
              style={{ fontSize: "var(--type-base)", marginBottom: "var(--space-3)" }}
            >
              <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Sent</span> — the
              office builds the quote from your scope.
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <button
              type="button"
              className="btn primary"
              style={{ width: "100%", fontSize: "var(--type-md)", padding: "var(--space-3)" }}
              onClick={() => setChoosing(false)}
              disabled={readOnly}
            >
              Quote it now
            </button>
            {!sentToOffice && (
              <button
                type="button"
                className="btn"
                style={{ width: "100%", fontSize: "var(--type-md)", padding: "var(--space-3)" }}
                onClick={sendToOffice}
                disabled={readOnly}
              >
                Send scope to the office
              </button>
            )}
          </div>
          {sendError && (
            <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
              {sendError}
            </div>
          )}
          {/* Scope and photos are quiet level-0 rows BENEATH the actions (Owen's picked design,
              Aug 11 mockups): the walkthrough's job is choosing what happens next, and scope
              only matters to the send-to-office path above it. This chooser is now the ONLY
              home of scope UI — the builder and a committed job are money only. */}
          <div style={{ marginTop: "var(--space-4)" }}>
            <SheetRow
              label="Scope"
              value={(scopeVisit?.scopeNotes ?? "").trim() ? "written" : "Add"}
              valueIsHint={!(scopeVisit?.scopeNotes ?? "").trim()}
              expandable
              open={scopeRowOpen}
              onOpenChange={setScopeRowOpen}
            >
              <ScopeNotesRow
                scopeNotes={scopeVisit?.scopeNotes ?? ""}
                disabled={readOnly}
                openSignal={scopeOpenSignal}
                onSave={saveScope}
              />
            </SheetRow>
            <SheetRow
              label="Photos"
              value={(job.photos ?? []).length > 0 ? String((job.photos ?? []).length) : "Add"}
              valueIsHint={(job.photos ?? []).length === 0}
              expandable
            >
              <ScopePhotos job={job} disabled={readOnly} />
              {measurementSurfacesVisible(measurementGate) && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  {scanBlocker === null ? (
                    <button
                      type="button"
                      className="btn sm scanbtn"
                      onClick={() => pushModal(MODAL.ROOM_CARD, { jobId: job.id, mode: "scan" })}
                    >
                      Scan a room
                    </button>
                  ) : (
                    <ScanUnavailable blocker={scanBlocker} label="Scan a room" />
                  )}
                </div>
              )}
            </SheetRow>
          </div>
        </div>
      )}

      {/* The price — the embedded builder (its own sticky foot is THE foot). On a COMMITTED job
          (booked or signed) the builder frames itself ("Booked" / "Sold — signed" over the
          change order), so a "The price" header here would caption a section that no longer
          exists. */}
      {showBuilder && !readOnly && (
        <>
          {canGoBack && builderMode === "edit" && (
            <button
              type="button"
              className="btn ghost sm"
              style={{ alignSelf: "flex-start", marginBottom: "var(--space-2)" }}
              onClick={() => setChoosing(true)}
            >
              ← Back
            </button>
          )}
          {builderMode === "edit" && !committed && (
            <div className="fsec" style={{ marginBottom: 0 }}>
              <div className="fsec-h">
                <span>The price</span>
              </div>
            </div>
          )}
          <TechQuoteBuilder
            jobId={job.id}
            embedded
            onModeChange={setBuilderMode}
            onSigned={onSigned}
          />
        </>
      )}

      {/* A CLOSED job's quote is still a record worth reading — it used to render nothing here
          at all, which read as "this job has no quote" on a job with a signed one (Owen: "this is
          all I see"). The lines and the total, read-only, with the honest next step named: the
          price of a closed job changes by reopening it, not from this tab. Null rates are a
          redacted device, never $0. */}
      {readOnly && (job.lines ?? []).some((l) => (l.d ?? "").trim()) ? (
        <div className="fsec">
          <div className="fsec-h">
            <span>{job.sourceEstimateId ? "Sold — signed" : committed ? "Booked" : "The price"}</span>
            <span className="fig">
              {(job.lines ?? []).some((l) => l.r == null)
                ? ""
                : fmt$2((job.lines ?? []).reduce((sum, l) => sum + (l.r ?? 0) * (l.q ?? 1), 0))}
            </span>
          </div>
          <div className="card">
            {(job.lines ?? []).map((l, i) => (
              <div
                key={i}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
              >
                <span>{l.d}</span>
                <b className="fig">{l.r == null ? "—" : fmt$2((l.r ?? 0) * (l.q ?? 1))}</b>
              </div>
            ))}
          </div>
          {/* The signed record reads the same on a closed job — the dispute it settles usually
              starts after the work is done. */}
          {job.sourceEstimateId && <SignedRecordRow job={job} />}
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-3)" }}>
            This job is closed. Reopen it from the Job tab to add a change order.
          </div>
        </div>
      ) : null}

      {/* No builder on screen (estimate pre-choice, or closed job) — the tab still
          docks ONE primary: a plain Done, same as the Job tab's default. */}
      {(!showBuilder || readOnly) && (
        <div className="sheet-foot">
          <button className="sheet-pri" onClick={close}>
            Done
          </button>
        </div>
      )}
    </>
  );
}
