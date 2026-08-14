/**
 * components/modals/room-card-modal.tsx
 * Room card drill-in — the centerpiece of measurements ("tap the room, tap the
 * number, fix the number"). Opened from JobMeasureBlock, either to view/edit an
 * existing room capture ({ captureId, jobId }) or to create a manual room
 * ({ jobId } only, no captureId).
 *
 * View mode is a record viewer, not a form: every quantity edits itself in-row
 * (SheetRow expandable → Field → commit on blur/Enter), so there is no filled
 * .sheet-pri — the whole footer is just the quiet "Remove room" two-tap.
 *
 * Create mode is the opposite: a plain form (name + six optional quantities)
 * with ONE .sheet-pri, "Add room", that awaits addManualRoom's `persisted`
 * promise before closing — mirrors new-job-modal's addLead.persisted pattern.
 */

"use client";

import { useState, type FormEvent } from "react";
import { useActiveModal, useAppStore, useCloseModal, usePushModal } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { MODAL } from "@/lib/store/modal-ids";
import { ModalLoading } from "./modal-loading";
import { useJobRooms } from "@/features/measurements/use-job-rooms";
import { useRoomScanAvailability, RoomScanPayloadError, RoomScanCaptureError } from "@/lib/native/room-scan";
import { ScanUnavailable } from "@/components/shared/scan-unavailable";
import { RoomDeductions } from "./room-deductions";
import { SheetRow } from "./sheet-row";
import { Field } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { SrcPill } from "@/components/shared/stage-pill";
import { formatDate } from "@/lib/format";
import { userMessage } from "@/lib/trpc/error-map";
import type { RoomCard, RoomQuantity, RoomQuantityKind } from "@/lib/store/types";

/** Copy shared by the scan-mode form and the live re-scan control. */
const SCAN_PAYLOAD_ERROR_COPY = "The scan returned unreadable data. Scan again.";
/** ONLY for the ingest phase (the server mutate call) — never the capture phase, which has its
 * own native-authored message via RoomScanCaptureError. */
const SCAN_SAVE_ERROR_COPY = "Couldn't save this scan — check your connection and try again.";

/**
 * Maps a thrown scanRoom/rescanRoom error to its inline copy.
 *  - RoomScanPayloadError (capture phase: the native plugin's JSON was unparseable) → the
 *    named payload copy.
 *  - RoomScanCaptureError (capture phase: the native `captureRoom` call itself rejected) →
 *    the native message VERBATIM — it's already functional, user-facing copy ("The scan
 *    didn't capture a floor…", "A room scan is already open.", a LiDAR-loss message) and
 *    collapsing it into the generic connection copy would misattribute e.g. a no-floor scan
 *    to a network problem.
 *  - Anything else (ingest phase: the server `mutate` call failed) → the generic connection
 *    copy — that failure mode genuinely IS "couldn't reach the server."
 */
function scanErrorCopy(err: unknown): string {
  if (err instanceof RoomScanPayloadError) return SCAN_PAYLOAD_ERROR_COPY;
  if (err instanceof RoomScanCaptureError) return err.message;
  // Ingest phase: a server VALIDATION reject must name its real reason — the
  // connection copy is only the fallback for genuine transport failures.
  // (Owen's first on-device scan hit a wire-format reject and was told to
  // check his wifi — same dishonesty class as the new-job phone bug.)
  return userMessage(err, SCAN_SAVE_ERROR_COPY);
}

// ---- quantity kinds: fixed order, trade labels, unit shape -----------------

type QuantityUnit = "sqft" | "lnft" | "count";

interface QuantityDef {
  kind: RoomQuantityKind;
  label: string;
  unit: QuantityUnit;
}

/** Fixed display order — never re-sorted by whatever order the server returns. */
const QUANTITY_DEFS: readonly QuantityDef[] = [
  { kind: "walls_sqft", label: "Walls (sq ft)", unit: "sqft" },
  { kind: "ceiling_sqft", label: "Ceiling (sq ft)", unit: "sqft" },
  // Directly under Ceiling, because that is where a soffit IS — a box hung off it. The scanner
  // cannot see one, so this row is always the painter's own number.
  { kind: "soffit_sqft", label: "Soffit / bulkhead (sq ft)", unit: "sqft" },
  { kind: "baseboard_lnft", label: "Baseboard (ln ft)", unit: "lnft" },
  { kind: "crown_lnft", label: "Crown (ln ft)", unit: "lnft" },
  { kind: "doors_count", label: "Doors", unit: "count" },
  { kind: "windows_count", label: "Windows", unit: "count" },
];

/**
 * The kinds whose EXISTENCE the scanner cannot see, so "none" is a real answer worth one tap.
 *
 * A soffit belongs here for the same reason as trim: plenty of rooms have none, and leaving the row
 * unanswered is indistinguishable from not having looked. Walls, ceiling, doors and windows are
 * measured or counted — "none" is not a thing you tell the app about them.
 */
const TRIM_KINDS: readonly RoomQuantityKind[] = ["baseboard_lnft", "crown_lnft", "soffit_sqft"];
const isTrim = (kind: RoomQuantityKind): boolean => TRIM_KINDS.includes(kind);

/** 1 decimal for sq ft / ln ft, whole numbers for counts. */
export function formatQuantity(value: number, unit: QuantityUnit): string {
  return unit === "count" ? String(Math.round(value)) : value.toFixed(1);
}

function findQuantity(room: RoomCard, kind: RoomQuantityKind): RoomQuantity | undefined {
  return room.quantities.find((q) => q.kind === kind);
}

// ---- status → display law ---------------------------------------------------

export interface QuantityDisplay {
  value: string;
  valueIsHint: boolean;
  badge: { tone: BadgeTone; text: string } | null;
  measured: string | null;
}

/**
 * Renders one quantity per the status law in the Task 8 brief:
 *  - needs_confirm → amber "Confirm" badge; the suggestion (derivedValue, e.g. the
 *    perimeter-convention trim number) as a muted hint when present, "Add" otherwise.
 *  - manual-source rows are ALWAYS plain — everything on a manual room is
 *    typed by definition, so nothing there is ever "edited" or "confirmed".
 *  - override (scan source) → the edited value + a blue "edited" badge + the
 *    muted original scan value beside it, so an override never reads measured.
 *  - confirmed (scan source, derivedValue null — a resolved vaulted value with
 *    no scan number underneath it) → green "confirmed" badge.
 *  - derived, or anything else → plain value, no badge.
 */
export function quantityDisplay(
  q: RoomQuantity,
  source: RoomCard["source"],
  unit: QuantityUnit,
): QuantityDisplay {
  const effective = q.value ?? q.derivedValue;

  // Manual rooms are typed by definition — this check runs BEFORE the
  // needs_confirm/override/confirmed branches below so "no badges on manual
  // rooms" holds for every status, not just the "confirmed" shape
  // addManualRoom happens to seed. A manual room is always a plain value.
  if (source === "manual") {
    if (effective == null) return { value: "Add", valueIsHint: true, badge: null, measured: null };
    return { value: formatQuantity(effective, unit), valueIsHint: false, badge: null, measured: null };
  }

  if (q.status === "needs_confirm") {
    // A suggestion (trim conventions: perimeter-derived baseboard/crown) renders as a muted
    // hint value behind the Confirm badge — visibly NOT a measurement. Tapping opens the
    // editor prefilled with it; committing (or zeroing a not-present trim) confirms.
    if (q.derivedValue != null) {
      return {
        value: formatQuantity(q.derivedValue, unit),
        valueIsHint: true,
        badge: { tone: "amber", text: "Confirm" },
        measured: null,
      };
    }
    return { value: "Add", valueIsHint: true, badge: { tone: "amber", text: "Confirm" }, measured: null };
  }

  if (effective == null) {
    return { value: "Add", valueIsHint: true, badge: null, measured: null };
  }
  const formatted = formatQuantity(effective, unit);

  if (q.status === "override") {
    const measured = q.derivedValue != null ? `measured ${formatQuantity(q.derivedValue, unit)}` : null;
    return { value: formatted, valueIsHint: false, badge: { tone: "blue", text: "edited" }, measured };
  }

  if (q.status === "confirmed" && q.derivedValue == null) {
    return { value: formatted, valueIsHint: false, badge: { tone: "green", text: "confirmed" }, measured: null };
  }

  return { value: formatted, valueIsHint: false, badge: null, measured: null };
}

// ---- input parsing -----------------------------------------------------------

/** Parses committed editor text into a validated non-negative number, or an error naming the bad value. */
export function parseQuantityInput(
  raw: string,
  unit: QuantityUnit,
): { ok: true; value: number } | { ok: false; error: string } | { ok: "empty" } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: "empty" };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, error: `"${trimmed}" is not a number.` };
  if (unit === "count" && !Number.isInteger(n)) {
    return { ok: false, error: `"${trimmed}" is not a whole number.` };
  }
  if (n < 0) return { ok: false, error: `"${trimmed}" can't be negative.` };
  return { ok: true, value: n };
}

// ---- quantity row (view mode) ------------------------------------------------

function QuantityRow({
  def,
  quantity,
  source,
  note,
  readOnly,
  onCommit,
}: {
  def: QuantityDef;
  quantity: RoomQuantity;
  source: RoomCard["source"];
  /** A caveat about THIS row's suggestion, shown where it is about to be accepted. */
  note?: string | null;
  /** Techs read the numbers; confirming/overriding them into the record is desk work
   *  (v1.measurements.confirmQuantity / overrideQuantity stay ownerOrOffice). */
  readOnly: boolean;
  onCommit: (kind: RoomQuantityKind, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const display = quantityDisplay(quantity, source, def.unit);

  if (readOnly) {
    return (
      <SheetRow
        label={def.label}
        value={display.value}
        valueIsHint={display.valueIsHint}
        after={
          (display.badge || display.measured) && (
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
              {display.measured && <span className="muted">{display.measured}</span>}
              {display.badge && <Badge tone={display.badge.tone}>{display.badge.text}</Badge>}
            </span>
          )
        }
      />
    );
  }

  function openEditor(next: boolean) {
    setOpen(next);
    if (next) {
      const effective = quantity.value ?? quantity.derivedValue;
      setDraft(effective != null ? formatQuantity(effective, def.unit) : "");
      setError(null);
    }
  }

  function commit() {
    const parsed = parseQuantityInput(draft, def.unit);
    if (parsed.ok === "empty") {
      // No-op close — nothing typed, nothing to save.
      setOpen(false);
      setError(null);
      return;
    }
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    onCommit(def.kind, parsed.value);
    setOpen(false);
    setError(null);
  }

  return (
    <SheetRow
      label={def.label}
      value={display.value}
      valueIsHint={display.valueIsHint}
      after={
        (display.badge || display.measured) && (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
            {display.measured && <span className="muted">{display.measured}</span>}
            {display.badge && <Badge tone={display.badge.tone}>{display.badge.text}</Badge>}
          </span>
        )
      }
      expandable
      open={open}
      onOpenChange={openEditor}
    >
      <Field label={def.label}>
        <input
          type="text"
          inputMode={def.unit === "count" ? "numeric" : "decimal"}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {/* THE TWO ANSWERS A TRIM ROW ACTUALLY HAS.
          Accepting the calculated perimeter used to mean noticing the number was already in the box
          and pressing Enter; recording "this room has no crown" meant knowing that typing a zero
          would do it. Neither reads as an option, so both are buttons:
            · the calculation, named and carrying its number — the scanner's perimeter, taken.
            · None in this room — the honest answer for rubber cove base or a ceiling with no crown,
              and a CONFIRMED zero rather than a row nobody answered. */}
      {(quantity.derivedValue != null || isTrim(def.kind)) && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-3)" }}>
          {quantity.derivedValue != null && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                onCommit(def.kind, quantity.derivedValue as number);
                setOpen(false);
                setError(null);
              }}
            >
              Use measured {formatQuantity(quantity.derivedValue, def.unit)}
            </button>
          )}
          {isTrim(def.kind) && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                onCommit(def.kind, 0);
                setOpen(false);
                setError(null);
              }}
            >
              None in this room
            </button>
          )}
        </div>
      )}
      {note && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {note}
        </p>
      )}
      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>
      )}
    </SheetRow>
  );
}

/**
 * A soffit invalidates the crown suggestion.
 *
 * Crown is offered as the FLOOR perimeter, on the flat-ceiling convention that the ceiling outline
 * matches the floor's. A boxed soffit is exactly the case where it does not — the crown either dies
 * into the soffit or runs around it, and either way the number is not the floor's perimeter. Said
 * where the suggestion is about to be accepted, rather than left for the painter to discover on
 * site.
 */
function crownNote(room: RoomCard): string | null {
  const soffit = room.quantities.find((q) => q.kind === "soffit_sqft");
  const hasSoffit = soffit?.value != null && soffit.value > 0;
  if (!hasSoffit) return null;
  return "This room has a soffit, so the crown run is not simply the floor perimeter — check whether it dies into the soffit or wraps it.";
}

// ---- room name row (rename, view mode) ---------------------------------------

function RoomNameRow({ room, onRename }: { room: RoomCard; onRename: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(room.roomName);

  function openEditor(next: boolean) {
    setOpen(next);
    if (next) setDraft(room.roomName);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== room.roomName) onRename(trimmed);
    setOpen(false);
  }

  return (
    <SheetRow label="Room name" value={room.roomName} expandable open={open} onOpenChange={openEditor}>
      <Field label="Room name">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
    </SheetRow>
  );
}

// ---- remove room (two-tap armed delete, sweep-modal pattern) -----------------

function RemoveRoomRow({ onRemove }: { onRemove: () => void }) {
  const [armed, setArmed] = useState(false);

  return (
    <div className="sheet-foot">
      <button
        type="button"
        className="btn ghost"
        style={{ color: "var(--red)", borderColor: armed ? "var(--red)" : undefined, width: "100%" }}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          onRemove();
        }}
      >
        {armed ? "Really remove this room? Tap again" : "Remove room"}
      </button>
    </div>
  );
}

// ---- live re-scan (two-tap armed control; only when scanning is actually ready — the
//      caller renders ScanUnavailable in its place on any device that cannot scan) ----

function RescanRow({
  jobId,
  captureId,
  roomName,
}: {
  jobId: string;
  captureId: string;
  roomName: string;
}) {
  const pushModal = usePushModal();
  const close = useCloseModal();
  const rescanRoom = useAppStore((s) => s.rescanRoom);
  const [armed, setArmed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire() {
    if (scanning) return;
    setError(null);
    setScanning(true);
    try {
      const room = await rescanRoom(jobId, captureId, roomName);
      if (room) {
        // Re-point the card onto the new capture id — old id is superseded.
        close();
        pushModal(MODAL.ROOM_CARD, { captureId: room.id, jobId });
        return;
      }
      // null = user cancelled the native screen — disarm silently, no error.
      setArmed(false);
    } catch (err: unknown) {
      setError(scanErrorCopy(err));
      setArmed(false);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ padding: "var(--space-3) 0" }}>
      {/* `scanbtn` alongside `linklike` so the LIVE control and the disabled one
          (ScanUnavailable's link variant) are the same control in two states — see
          `button.linklike.scanbtn` in prototype.css for why the class is load-bearing. */}
      <button
        type="button"
        className="linklike scanbtn"
        disabled={scanning}
        onClick={() => (armed ? void fire() : setArmed(true))}
      >
        {scanning
          ? "Scanning…"
          : armed
            ? "Replaces these numbers and clears edits — tap again"
            : "Re-scan room"}
      </button>
      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>
      )}
    </div>
  );
}

// ---- source pill (sheet-meta) -------------------------------------------------

function sourceLabel(room: RoomCard): string {
  return room.source === "manual" ? "Manual" : `Scanned · ${formatDate(room.capturedAt)}`;
}

// ---- view mode ----------------------------------------------------------------

function ViewRoom({ room, jobName }: { room: RoomCard; jobName: string | undefined }) {
  const jobId = room.jobId;
  // Role gate: quantity confirm/override write ownerOrOffice endpoints — for a tech the
  // rows are read-only (fail closed until the role loads). Scan/rename/archive/re-scan
  // are field work and stay live (v1.measurements allows an assigned tech).
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";
  const setRoomQuantity = useAppStore((s) => s.setRoomQuantity);
  const addDeduction = useAppStore((s) => s.addDeduction);
  const removeDeduction = useAppStore((s) => s.removeDeduction);
  const renameRoom = useAppStore((s) => s.renameRoom);
  const archiveRoom = useAppStore((s) => s.archiveRoom);
  const close = useCloseModal();
  const scan = useRoomScanAvailability();

  function commitQuantity(kind: RoomQuantityKind, value: number) {
    setRoomQuantity(jobId, room.id, kind, value);
  }

  function remove() {
    archiveRoom(jobId, room.id);
    close();
  }

  return (
    <>
      <div className="sheet-head">
        <h2>{room.roomName}</h2>
        <div className="sheet-meta">
          <SrcPill src={sourceLabel(room)} />
          {jobName && <span>{jobName}</span>}
        </div>
      </div>

      <div className="sheet-rows">
        <RoomNameRow room={room} onRename={(name) => renameRoom(jobId, room.id, name)} />

        {QUANTITY_DEFS.map((def) => {
          const quantity = findQuantity(room, def.kind);
          if (!quantity) return null;
          return (
            <QuantityRow
              key={def.kind}
              def={def}
              quantity={quantity}
              source={room.source}
              note={def.kind === "crown_lnft" ? crownNote(room) : null}
              readOnly={!isOffice}
              onCommit={commitQuantity}
            />
          );
        })}

        {/* Wall area the scan measured but nobody paints. Sits under the quantities because it
            modifies one of them — the net it prints IS what an estimate prices from. */}
        <RoomDeductions
          room={room}
          readOnly={!isOffice}
          onAdd={(d) => addDeduction(jobId, room.id, d)}
          onRemove={(id) => removeDeduction(jobId, room.id, id)}
        />

        {/* A scanned room always offers Re-scan. When this device/platform cannot scan, the
            control is disabled and says why — the old fallback here printed "Re-scan replaces
            these numbers and clears edits", which described a re-scan the reader had no way to
            start and never mentioned that they couldn't. */}
        {room.source === "roomplan_v1" &&
          (scan.status === "ready" ? (
            <RescanRow jobId={jobId} captureId={room.id} roomName={room.roomName} />
          ) : (
            <div style={{ padding: "var(--space-3) 0" }}>
              <ScanUnavailable
                blocker={{ kind: "device", availability: scan }}
                label="Re-scan room"
                variant="link"
              />
            </div>
          ))}
      </div>

      <RemoveRoomRow onRemove={remove} />
    </>
  );
}

// ---- create mode ----------------------------------------------------------------

function CreateRoom({ jobId, jobName }: { jobId: string; jobName: string | undefined }) {
  const close = useCloseModal();
  const addManualRoom = useAppStore((s) => s.addManualRoom);

  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Record<RoomQuantityKind, string>>({
    walls_sqft: "",
    ceiling_sqft: "",
    soffit_sqft: "",
    baseboard_lnft: "",
    crown_lnft: "",
    doors_count: "",
    windows_count: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setDraft(kind: RoomQuantityKind, value: string) {
    setDrafts((prev) => ({ ...prev, [kind]: value }));
  }

  /** Parses every filled-in field; returns null (with `error` set) on the first bad value. */
  function collectQuantities(): { kind: RoomQuantityKind; value: number }[] | null {
    const collected: { kind: RoomQuantityKind; value: number }[] = [];
    for (const def of QUANTITY_DEFS) {
      const parsed = parseQuantityInput(drafts[def.kind], def.unit);
      if (parsed.ok === "empty") continue;
      if (!parsed.ok) {
        setError(parsed.error);
        return null;
      }
      collected.push({ kind: def.kind, value: parsed.value });
    }
    return collected;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const quantities = collectQuantities();
    if (quantities === null) return;

    setSaving(true);
    try {
      const { persisted } = addManualRoom(jobId, name, quantities);
      await persisted;
      close();
    } catch {
      setError("Couldn't save this room — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="sheet-head">
        <h2>New room</h2>
        <div className="sheet-meta">
          <SrcPill src="Manual" />
          {jobName && <span>{jobName}</span>}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Field label="Room name">
          <input type="text" placeholder="e.g. Living room" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        {QUANTITY_DEFS.map((def) => (
          <Field key={def.kind} label={def.label}>
            <input
              type="text"
              inputMode={def.unit === "count" ? "numeric" : "decimal"}
              value={drafts[def.kind]}
              onChange={(e) => setDraft(def.kind, e.target.value)}
            />
          </Field>
        ))}

        {error && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{error}</p>
        )}

        <div className="sheet-foot">
          <button type="submit" className="sheet-pri" disabled={saving}>
            {saving ? "Adding…" : "Add room"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- scan mode ----------------------------------------------------------------

function ScanRoom({ jobId, jobName }: { jobId: string; jobName: string | undefined }) {
  const pushModal = usePushModal();
  const close = useCloseModal();
  const scanRoom = useAppStore((s) => s.scanRoom);

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function startScanning() {
    if (scanning) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name this room before scanning.");
      return;
    }
    setError(null);
    setScanning(true);
    try {
      const room = await scanRoom(jobId, trimmed);
      if (room) {
        // Re-open the card on the real capture — back-stack to the job modal preserved.
        close();
        pushModal(MODAL.ROOM_CARD, { captureId: room.id, jobId });
        return;
      }
      // null = user cancelled the native screen — form stays, no error.
    } catch (err: unknown) {
      setError(scanErrorCopy(err));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <div className="sheet-head">
        <h2>Scan room</h2>
        <div className="sheet-meta">
          <SrcPill src="Scan" />
          {jobName && <span>{jobName}</span>}
        </div>
      </div>

      <Field label="Room name">
        <input
          type="text"
          placeholder="e.g. Living room"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{error}</p>
      )}

      <div className="sheet-foot">
        <button type="button" className="sheet-pri" disabled={scanning} onClick={() => void startScanning()}>
          {scanning ? "Scanning…" : "Start scanning"}
        </button>
      </div>
    </div>
  );
}

// ---- entry point ----------------------------------------------------------------

export function RoomCardModalContent() {
  const activeModal = useActiveModal();
  const jobId = activeModal?.params?.jobId as string | undefined;
  const captureId = activeModal?.params?.captureId as string | undefined;
  const mode = activeModal?.params?.mode as string | undefined;

  const roomsQ = useJobRooms(jobId);

  const room = useAppStore((s) =>
    jobId && captureId ? s.roomsByJob[jobId]?.find((r) => r.id === captureId) : undefined,
  );
  const job = useAppStore((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));

  if (!jobId) {
    return (
      <div>
        <div className="sheet-head">
          <h2>Room</h2>
        </div>
        <p className="muted">This room is no longer available.</p>
      </div>
    );
  }

  if (!captureId) {
    if (mode === "scan") return <ScanRoom jobId={jobId} jobName={job?.title} />;
    return <CreateRoom jobId={jobId} jobName={job?.title} />;
  }

  if (!room) {
    // While the rooms read is still in flight, "no longer available" is a false claim about a
    // room that is merely loading — the same wait-vs-error split every detail sheet makes.
    if (roomsQ.isLoading) return <ModalLoading size="md" />;
    return (
      <div>
        <div className="sheet-head">
          <h2>Room</h2>
        </div>
        <p className="muted">This room is no longer available — it may have been removed.</p>
      </div>
    );
  }

  return <ViewRoom room={room} jobName={job?.title} />;
}
