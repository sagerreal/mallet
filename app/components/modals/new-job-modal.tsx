/**
 * components/modals/new-job-modal.tsx
 * ONE job form — there is no Type chip. A job is a job; whether it is a scoping
 * visit or booked work DERIVES from whether a price is attached, which the foot
 * decides:
 *
 *   Create job          → the job as written, no price yet (kind "estimate" —
 *                         someone still has to look at the work before there is
 *                         a price; the tech's Quote tab offers the dual exit).
 *   Create & price it → → the same create, then straight into Build the price
 *                         (kind "service" — the price is the point, and saving
 *                         it BOOKS it).
 *
 * Field order: What's the job? · Customer (in-flow search-or-add picker over
 * live leads) + Phone · Service address · Visits (unplaced hours rows) ·
 * Checklist picker (both pools — scoping + before-you-leave, labeled) ·
 * Job notes · the three-button foot.
 *
 * Visits are created UNPLACED (date/techId/start null) — dragged onto the
 * Schedule board later, so there is NO date/crew picker at creation. The
 * default visit length derives with the kind: a still-untouched single default
 * retunes to the priced length when "Create & price it" is the exit.
 */

"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useCloseModal, useOpenModal, useLeads, useAppStore, useActiveModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import type { ChecklistItem, Job, Lead } from "@/lib/store/types";
import { ChecklistStepsEditor, newDraftStep, type DraftItem } from "@/features/jobs/checklist-steps-editor";
import { Field, FieldGroup } from "@/components/ui/input";
import { CustomerPicker } from "./new-job-customer-picker";
import { AddressInput } from "@/components/ui/address-input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { api } from "@/lib/trpc/client";
import { StagedAttachButton, StagedAttachStatus, useStagedAttachment, attachErrorMessage } from "@/components/shared/staged-attachment";
import { uploadJobFile } from "@/lib/store/upload-job-file";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { phoneFieldError } from "@/lib/phone";
import { userMessage } from "@/lib/trpc/error-map";
import { withListBatch } from "@/lib/trpc/list-cache";


// ---- constants --------------------------------------------------------------

/** Default visit length while the job is unpriced — a walkthrough, not a work slot. */
const UNPRICED_VISIT_H = 0.5;
/** Default visit length once "Create & price it" is the exit — real work takes real time.
 *  A LOCAL derivation from the button pressed; it never depended on the stored kind, so it is
 *  unaffected by both exits now creating the same shape. */
const PRICED_VISIT_H = 1.5;
/** Both defaults, used to detect a single still-untouched visit row worth retuning. */
const DEFAULT_VISIT_HOURS: readonly number[] = [UNPRICED_VISIT_H, PRICED_VISIT_H];

/** The staged (below-the-essentials) disclosure rows — one open at a time. */
type RowKey = "visits" | "chk" | "notes";

/** A visit row while composing — hours only, placed later on the Schedule. */
interface VisitRow {
  h: number;
}

/** Clip a collapsed-row summary to the row word budget. */
function clip(s: string, max = 28): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}


/** Round to the nearest quarter-hour, floored at 0.25 (prototype clamp). */
function clampHours(h: number): number {
  return Math.max(0.25, Math.round(h * 4) / 4);
}

// ---- component --------------------------------------------------------------

export function NewJobModalContent() {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const router = useRouter();
  const leads = useLeads();
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const addLead = useAppStore((s) => s.addLead);
  const updateLead = useAppStore((s) => s.updateLead);
  const updateJob = useAppStore((s) => s.updateJob);
  const attachJobFile = useAppStore((s) => s.attachJobFile);
  const adoptLead = useAppStore((s) => s.adoptLead);
  const checklists = useAppStore((s) => s.checklists);

  // Saved checklists feed the picker (hydrated from the DB). NOT filtered by stage: there is one
  // kind of checklist now, and a list left on the retired "scope" stage must still be pickable.
  const savedChecklists = checklists;

  // Only live (non-archived) leads feed the customer picker (prototype liveLeads()).
  const liveLeads = leads.filter((l) => !l.archived);


  // OPENED FROM A CUSTOMER. The customer sheet's "Create a job" passes the lead it was standing
  // in, so the job lands on that customer instead of asking for a name the app already knows —
  // retyping it invites picking the wrong one and attaching the job to somebody else.
  //
  // Seeded lazily rather than in an effect: modal-host unmounts this content when the sheet
  // closes (Modal returns null), so every open mounts fresh and the initialiser runs exactly once.
  // The submit path resolves the customer by NAME (matchLead), so seeding the field is enough to
  // link the job — no separate id to thread through.
  const activeModal = useActiveModal();
  const openedForLead = leads.find((l) => l.id === activeModal?.params?.leadId);

  // Core fields
  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState(() => openedForLead?.name ?? "");
  const [phone, setPhone] = useState(() =>
    openedForLead?.phone && openedForLead.phone !== "—" ? openedForLead.phone : "",
  );
  const [addr, setAddr] = useState(() => openedForLead?.address ?? "");
  const [notes, setNotes] = useState("");
  const staged = useStagedAttachment();

  // Visits (unplaced hours rows) — default one row at the unpriced length; the priced
  // exit retunes a still-untouched default at submit (see resolvedVisits).
  const [visits, setVisits] = useState<VisitRow[]>([{ h: UNPRICED_VISIT_H }]);

  // The staged rows (list-first accordion): one open at a time, front-desk
  // RuleRow precedent. The collapsed value is the summary.
  const [openRow, setOpenRow] = useState<RowKey | null>(null);
  const toggleRow = (k: RowKey) => setOpenRow((prev) => (prev === k ? null : k));

  // Checklist picker (lives in the checklist row).
  const [chkTpl, setChkTpl] = useState<string | null>(null);
  // From-scratch checklists are NAMED, and their steps carry an explicit Check/Photo type.
  // This used to be `string[]` with the name hardcoded to "Checklist" at snapshot time and the
  // type guessed by /photo|picture/i, so every list a shop built here arrived unnamed and a
  // "Photo of the panel" step became a photo only by luck of wording.
  const [chkName, setChkName] = useState("");
  const [chkItems, setChkItems] = useState<DraftItem[]>([]);
  // "you built a list but did not name it" — checked at submit, shown in the checklist row.
  const [chkErr, setChkErr] = useState<string | null>(null);


  // THE PICKER SEARCHES THE BOOK, NOT THE PAGE. The store holds one hydrated page (~50 rows), so
  // typing any customer outside it found nothing — "no customers come up". The server search runs
  // the same v1.customers.list the Customers screen uses; results are ADOPTED into the store on
  // pick so the submit path's matchLead (which resolves by name against the store) finds them.
  const custQuery = useDebouncedValue(customer.trim(), 250);
  const custSearch = api.v1.customers.list.useQuery(
    { search: custQuery, limit: 8 },
    { enabled: custQuery.length >= 2, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const pickerLeads = useMemo(() => {
    const seen = new Set(liveLeads.map((l) => l.id));
    const fromServer = (custSearch.data?.items ?? [])
      .filter((dto) => !seen.has(dto.id))
      .map(toStoreLead);
    return [...liveLeads, ...fromServer];
  }, [liveLeads, custSearch.data]);

  const [error, setError] = useState<string | null>(null);
  // Inline, field-level error — set before any network round trip so a bad
  // number never reaches the server just to learn it's bad.
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Set when a submit created the job but the checklist attach failed — a retry
  // re-attaches to THIS job instead of minting a duplicate (mirrors
  // job-checklist-block's createdRef). The modal unmounts on close, so the ref
  // cannot leak into the next open.
  const chkRetryJobRef = useRef<Job | null>(null);

  // ---- visit helpers (mirror njNudge / njAddVisit) --------------------------

  function nudgeVisit(i: number, d: number) {
    setVisits((prev) =>
      prev.map((v, vi) => (vi === i ? { h: clampHours(v.h + d) } : v)),
    );
  }

  function setVisitHours(i: number, val: string) {
    const parsed = Number.parseFloat(val);
    const next = clampHours(Number.isFinite(parsed) ? parsed : 0.25);
    setVisits((prev) => prev.map((v, vi) => (vi === i ? { h: next } : v)));
  }

  function addVisitRow() {
    setVisits((prev) => [...prev, { h: UNPRICED_VISIT_H }]);
  }

  function removeVisitRow(i: number) {
    setVisits((prev) => (prev.length <= 1 ? prev : prev.filter((_, vi) => vi !== i)));
  }

  // ---- customer picker (mirror njCustFill / njMatchLead) --------------------

  /** Resolve the typed name to a live lead by exact (case-insensitive) name — against the
   *  merged store+search list, so a customer outside the hydrated page still resolves. */
  function matchLead(name: string): Lead | undefined {
    const n = name.trim().toLowerCase();
    if (!n) return undefined;
    return pickerLeads.find((l) => l.name.toLowerCase() === n);
  }

  /** On picking an existing customer, prefill phone/address (don't clobber typed). */
  function fillFromLead(l: Lead) {
    if (!phone && l.phone && l.phone !== "—") setPhone(l.phone);
    if (!addr && l.address) setAddr(l.address);
  }

  /** The blur path — a typed-exact name resolves to its lead and prefill runs. */
  function fillFromCustomer(name: string) {
    const l = matchLead(name);
    if (l) fillFromLead(l);
  }

  // ---- checklist picker (mirror njPickChk / njAddChkItem) -------------------

  function pickChecklist(tpl: string) {
    const next = tpl === "" ? null : tpl;
    setChkTpl(next);
    setChkErr(null);
    if (next !== "blank") {
      // Picking a template (or none) completes the row — collapse to summary. The from-scratch
      // draft is dropped: it is not what the job carries any more, and leaving it would re-appear
      // if "Build from scratch" were pressed again.
      setChkName("");
      setChkItems([]);
      setOpenRow(null);
      return;
    }
    // "blank" keeps the row open: the from-scratch builder needs the space. One empty step is
    // seeded so the editor opens on a name AND somewhere to type, in that order.
    if (chkItems.length === 0) setChkItems([newDraftStep()]);
  }

  /** The picked checklist as a job snapshot — null when none picked. */
  function checklistSnapshot(): { name: string; items: ChecklistItem[] } | null {
    if (chkTpl === "blank") {
      // Blank steps are dropped, not saved as empty rows: `+ Add step` mints an empty one, so
      // an abandoned last step is the normal end state of typing a list.
      const steps = chkItems.filter((it) => it.text.trim().length > 0);
      if (steps.length === 0) return null;
      return {
        name: chkName.trim(),
        items: steps.map((it, i) => ({
          id: it.id,
          text: it.text.trim(),
          type: it.type,
          required: true,
          position: i,
        })),
      };
    }
    const saved = checklists.find((c) => c.id === chkTpl);
    return saved ? { name: saved.name, items: saved.items } : null;
  }

  // ---- create (mirror saveNewJob) -------------------------------------------

  /**
   * The list of visits to create — always at least one, clamped to quarters.
   *
   * A single STILL-UNTOUCHED default retunes to the exit that was chosen: the same
   * mechanic the old Type chips ran on switch, moved to the only moment the kind is
   * now known. An edited row is the user's number and is never retuned.
   */
  function resolvedVisits(priced: boolean): VisitRow[] {
    const def = priced ? PRICED_VISIT_H : UNPRICED_VISIT_H;
    const untouched =
      visits.length === 1 && visits[0] !== undefined && DEFAULT_VISIT_HOURS.includes(visits[0].h);
    const rows = untouched || visits.length === 0 ? [{ h: def }] : visits;
    return rows.map((v) => ({ h: clampHours(v.h) }));
  }


  /**
   * Resolve the typed customer to a real lead at SUBMIT time — the moment that matters.
   *
   * Three holes this closes, all found in review:
   *  - A name matched from the server search but never CLICKED was used for the job while the
   *    store never adopted it — the job modal then opened on "No linked customer".
   *  - The search is debounced 250ms; typing an exact name and submitting fast raced it, missed
   *    the match, and minted a duplicate customer. This awaits a direct search instead of hoping
   *    the debounced one settled.
   *  - The typed name might sit outside the debounced query's first page entirely.
   * Falls back to null (create a new customer) only after the server has actually been asked.
   */
  async function resolveTypedCustomer(name: string): Promise<Lead | null> {
    const local = matchLead(name);
    if (local) {
      if (!leads.some((x) => x.id === local.id)) adoptLead(local);
      return local;
    }
    if (name.length < 2) return null;
    try {
      const page = await trpcVanilla.v1.customers.list.query({ search: name, limit: 8 });
      const exact = page.items.find((d: { name: string }) => d.name.trim().toLowerCase() === name.toLowerCase());
      if (!exact) return null;
      const adopted = toStoreLead(exact);
      adoptLead(adopted);
      return adopted;
    } catch {
      // Offline or erroring search must not block booking — worst case is the pre-existing
      // behaviour (a duplicate the office merges later), never a lost job.
      return null;
    }
  }

  /**
   * ONE create for both exits — the kind DERIVES from which foot button ran:
   *
   *   BOTH exits create kind "estimate" — no price yet, so the job is unpriced, and saying
   *   otherwise was the bug. A real job either way (never a store-only evisit): it rides the
   *   server schedule window / crew-load / conflict checks like any other.
   *
   *   The flag decides only WHAT HAPPENS NEXT:
   *     priced=false ("Create job")        → done; the job waits to be priced.
   *     priced=true  ("Create & price it") → the caller lands in Build the price, whose SAVE
   *                                          books the job. Leaving without saving leaves it
   *                                          unpriced, which is the truth.
   *
   * For the "new customer" path (typed name with no matching lead) the lead is
   * created FIRST and its server-assigned id awaited — the job's lead FK must
   * reference a real row (customers.create assigns the id; jobs.create is the one
   * with a client-authored id). Visits are added only after the job reconciles to
   * origin "db" (addVisit guards on that before firing v1.visits.createVisit;
   * earlier, and they'd be silently dropped on refresh).
   *
   * THE PRICED, NO-CHECKLIST EXIT DOES NOT AWAIT THE JOB CREATE. The price builder
   * needs only the client-authored id, which exists synchronously — so the sheet
   * opens NOW and the create settles behind it (visits queue on it; a save inside
   * the window queues on it too — see setJobLines' pending-create gate). A refused
   * create rolls the job back and the builder switches to its not-loaded notice:
   * visible, never silent. The other two paths keep their await, deliberately —
   * the plain exit's failure surface is THIS modal (the board it lands on has
   * nowhere to say "the job didn't save"), and a picked checklist keeps the
   * attach-failure retry UX that lives here.
   *
   * Returns the created job, or null if the server create failed (error already
   * set via setError).
   */
  async function createJobRecord(job: string, priced: boolean): Promise<{ ok: boolean; createdJob: Job | null }> {
    // Retry after a failed checklist attach: the job (and its visits) already
    // persisted — only the attach is outstanding, so don't create a duplicate.
    if (chkRetryJobRef.current) return attachPickedChecklist(chkRetryJobRef.current);

    const rows = resolvedVisits(priced);
    const custName = customer.trim();
    const match = await resolveTypedCustomer(custName);

    // Resolve the matched lead, or create a new one and AWAIT the server id.
    let lead: Lead;
    if (match) {
      lead = match;
    } else {
      const { persisted } = addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        // A new customer starts untagged; the office tags from the customer list or the sheet.
        tags: [],
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      });
      try {
        lead = await persisted;
      } catch (err) {
        // The server's own reason (e.g. an invalid phone) outranks the generic
        // connection line — that line is only for a genuine transport failure.
        setError(userMessage(err, "Couldn't save the customer — check your connection and try again."));
        return { ok: false, createdJob: null };
      }
    }

    // Merge fill-ins onto an existing lead without clobbering (prototype behavior).
    //
    // Notes are deliberately NOT in this patch. This field is the JOB's notes (it rides
    // addJob below, and the row says so), and sending it here did the opposite of what the
    // line above promises: buildLeadUpdatePayload skips `notes`, so the write never reached
    // the database, while updateLead's optimistic set overwrote the customer's real notes in
    // the store for the rest of the session. The customer sheet's Notes composer is the way
    // to write a customer note; it persists through addLeadNote.
    const patch: Partial<Lead> = { job };
    if (phone.trim() && (!lead.phone || lead.phone === "—")) patch.phone = phone.trim();
    if (addr.trim() && !lead.address) patch.address = addr.trim();
    updateLead(lead.id, patch);

    const { job: created, persisted: jobPersisted } = addJob({
      leadId: lead.id,
      // ONE SHAPE FOR BOTH EXITS: a job with no price is an unpriced job, whichever button
      // made it. The price builder's save is what books it ("an unpriced job's kind flips
      // estimate -> work on save … this save IS the fork").
      //
      // The priced exit used to commit `svc: "service"` right here, forking the job before a
      // price existed. Leaving the builder by "Price later" then stranded a job typed as booked
      // work that was never priced (`kind=work svc=service lines=0` in production), and the
      // technician's Quote tab routed to the editable builder instead of the "Quote it now /
      // Send scope to the office" chooser — with no way back to it, because the fork had already
      // happened. The button chooses WHERE THE USER GOES NEXT, never what the job is.
      kind: "estimate",
      svc: "",
      origin: "manual",
      title: job,
      addr: addr.trim() || (lead.address ?? ""),
      phone: phone.trim() || (lead.phone && lead.phone !== "—" ? lead.phone : ""),
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: notes.trim(),
      acts: [],
      visits: [],
    });
    // Each visit is created UNPLACED (hours only) — dragged onto the Schedule later. They queue
    // behind the create on every path: addVisit is store-only until origin flips to "db", so
    // firing it earlier silently drops the rows. The board's ?place= arm already retries until
    // the store shows an unplaced visit, so a visit landing a beat after the nav is fine.
    const settled = jobPersisted.then((persistedJob) => {
      rows.forEach((v) => addVisit(created.id, v.h));
      return persistedJob;
    });

    // A staged file needs the job to be DB-origin before it can be uploaded and attached, so it
    // rules out the optimistic hand-off for exactly the reason a checklist does.
    if (priced && !checklistSnapshot() && !staged.file) {
      // The optimistic hand-off (see the function comment): the builder opens on the
      // client-authored id now. A refused create rolls back in the slice (dev-logged there)
      // and the builder renders its not-loaded notice — swallow here only to keep the
      // rejection from surfacing as unhandled.
      void settled.catch(() => undefined);
      return { ok: true, createdJob: created };
    }

    try {
      await settled;
    } catch (err) {
      setError(userMessage(err, "The customer was saved, but the job wasn't — check your connection and try again."));
      return { ok: false, createdJob: null };
    }

    // The picked checklist rides the job either way — a scoping list on an unpriced
    // job exactly as a before-you-leave list rides booked work.
    return attachPickedChecklist(created);
  }

  /** Attach the picked before-you-leave checklist to the created job. Must run
   *  AFTER jobPersisted — updateJob only persists once the job is DB-origin.
   *  AWAITED: updateJob resolves { ok:false } on a failed persist (the slice
   *  rolls back with a dev-only log), so a fire-and-forget here would ship the
   *  job with its checklist silently missing. */
  async function attachPickedChecklist(created: Job): Promise<{ ok: boolean; createdJob: Job | null }> {
    const checklist = checklistSnapshot();
    if (checklist) {
      const { ok } = await updateJob(created.id, { checklist });
      if (!ok) {
        chkRetryJobRef.current = created;
        setError("The job was saved, but the checklist wasn't — try again.");
        return { ok: false, createdJob: null };
      }
    }
    chkRetryJobRef.current = null;
    if (!(await attachStagedFile(created.id))) return { ok: false, createdJob: null };
    return { ok: true, createdJob: created };
  }

  /**
   * Upload the staged file against the now-real job id and hang it on the job.
   *
   * Returns false with the reason on screen when it failed. The job IS saved by this point, so a
   * swallowed failure would close the modal on an office that believes its permit went with the
   * job — the same reasoning as the checklist attach above.
   */
  async function attachStagedFile(jobId: string): Promise<boolean> {
    const file = staged.file;
    if (!file) return true;
    try {
      attachJobFile(jobId, await uploadJobFile(jobId, file));
      return true;
    } catch (err: unknown) {
      staged.setError(attachErrorMessage(err));
      setError("The job was saved, but the file wasn't — try again.");
      return false;
    }
  }

  /** Validate + create. The create is async (awaits the persisted lead, then the
   *  persisted job); returns a promise resolving to { ok, job }. */
  async function commit(priced: boolean): Promise<{ ok: boolean; job: Job | null }> {
    const job = title.trim();
    if (!job) {
      setError("Add what the job is.");
      return { ok: false, job: null };
    }
    // Client-side mirror of the server's Phone.parse rule — catch a bad number
    // here, before it round-trips to the server just to bounce with a
    // misleading "check your connection" message.
    const badPhone = phoneFieldError(phone);
    if (badPhone) {
      setPhoneError(badPhone);
      return { ok: false, job: null };
    }
    // A from-scratch list with steps and no name: refuse, and say which field. Attaching it
    // unnamed is how every custom list ended up called "Checklist"; dropping it silently would
    // throw away typing the crew will look for on the job.
    if (chkTpl === "blank" && !chkName.trim() && chkItems.some((it) => it.text.trim())) {
      setChkErr("Name the checklist.");
      setOpenRow("chk");
      return { ok: false, job: null };
    }
    setChkErr(null);
    const { ok, createdJob } = await createJobRecord(job, priced);
    return { ok, job: createdJob };
  }

  /**
   * ONE guarded entry point for both submit buttons.
   *
   * `commit()` is two awaited round trips — create the customer, then the job, then its visit —
   * roughly a second before the modal closes, and every one of those calls mints a fresh UUID.
   * Unguarded, three impatient clicks produced three customers, three jobs and three visits (seen
   * in production: v1.customers.create → v1.jobs.create → v1.visits.createVisit, ×3, all 200).
   * Server idempotency cannot save this — customers.create takes no client id and dedupes only on
   * a non-null phone — so the guard has to be here.
   *
   * The ref is checked synchronously because `disabled` only takes effect on the next render: a
   * same-tick second click is dispatched before that. Same reasoning, and the same shape, as
   * new-customer-modal.tsx.
   */
  const inFlightRef = useRef(false);
  // WHICH exit is in flight — the pressed button reads "Creating…", its sibling just disables.
  const [savingPath, setSavingPath] = useState<null | "plain" | "priced">(null);
  const saving = savingPath !== null;

  async function submitCreate(priced: boolean): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSavingPath(priced ? "priced" : "plain");
    try {
      // THE LIST REFETCHES WAIT FOR THE CHAIN, NOT FOR EACH LINK OF IT. commit() is two or three
      // awaited writes in a row, and each one used to refetch every jobs, customers and invoice
      // list the moment it landed — while the NEXT write in the chain, the one the user is
      // watching the button spin for, was already going out beside it. Measured in the browser,
      // the customers refetch was dispatched one millisecond ahead of v1.jobs.create and was still
      // in flight across it on every press. withListBatch holds all of it to the end of the chain
      // and then refetches once: same domains, same keys, so nothing on screen goes stale — it
      // just stops happening three times, and stops happening in front of the create.
      const { ok, job } = await withListBatch(() => commit(priced));
      if (!ok) return;
      close();
      if (!job) return;
      // A NEW JOB'S NEXT STEP IS A SLOT ON THE BOARD. Owen, testing: "when I create the flat rate
      // job it brings me to the job modal, it should be bringing me to the scheduling page so I
      // can drag and drop it". Every job here is created with UNPLACED visits by definition —
      // there is no date picker in this form — so the record sheet was a dead end and the board is
      // the only place the work becomes real. `?place=` arms the new job there.
      //
      // Already on the board? Same push: the pathname is unchanged, so this only updates the query
      // and arms — it does not yank anyone off the board they are standing on.
      router.push(`/jobs?tab=schedule&place=${job.id}`);
      if (priced) {
        // "Create & price it" — ask for the price while it is still in the user's head.
        // A ROOT open, not a drill-in: the builder's own ✕ / Price later / save all call close(),
        // which now reveals the BOARD behind it rather than popping to a job sheet. No new exit
        // control, and ModalHost has no route-change close, so it survives the nav above.
        openModal(MODAL.PRICE_BUILDER, { jobId: job.id });
      }
    } finally {
      // Released in `finally`, never only on success: commit() deliberately supports retry (the
      // checklist-attach path re-enters with the job already created), and a stuck guard would
      // leave the modal permanently unable to submit.
      inFlightRef.current = false;
      setSavingPath(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Programmatic submits take the primary exit — create, then straight into the price.
    await submitCreate(true);
  }

  // ---- collapsed row summaries (the value IS the state) ---------------------

  const chkIsBlank = chkTpl === "blank";
  const chkPicked = checklists.find((c) => c.id === chkTpl);
  const chkCurName = !chkTpl
    ? "No checklist"
    : chkIsBlank
      ? (chkName.trim() || "New checklist")
      : (chkPicked?.name ?? "No checklist");

  const visitsTotalH = visits.reduce((s, v) => s + v.h, 0);
  const visitsSummary = `${visits.length} visit${visits.length > 1 ? "s" : ""} · ${visitsTotalH}h`;
  const notesSummary = notes.trim() ? clip(notes) : "Add";

  // ---- render ---------------------------------------------------------------

  return (
    <div>
      {/* Sticky sheet header — the title never scrolls away on a tall sheet. */}
      <div className="sheet-head">
        <h2>New job</h2>
      </div>

      {/* ENTER NEVER CREATES THE JOB. The browser's implicit submission meant Enter in any text
          field — the phone, the address, a checklist item — created and saved the job mid-thought.
          Per the HTML spec, implicit submission needs a DEFAULT BUTTON: this form deliberately has
          no type="submit" control (the primary is type="button"), so a multi-field form like this
          one submits only when that button is clicked. onSubmit stays for programmatic submits. */}
      <form onSubmit={handleSubmit}>
        {/* What's the job? */}
        <Field label="What's the job?">
          <input
            type="text"
            placeholder="e.g. water heater repair"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </Field>

        {/* No Type chips. Whether this is a scoping visit or booked work derives from the
            foot: "Create job" (no price yet) vs "Create & price it" (the price is known). */}

        {/* Customer (in-flow search-or-add picker) + Phone */}
        <div
          className="row2"
          style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}
        >
          <Field label="Customer" style={{ marginBottom: "0" }}>
            <CustomerPicker
              value={customer}
              leads={pickerLeads}
              onChange={setCustomer}
              onPick={(l) => {
                // A server-found customer is not in the store yet; adopt so matchLead resolves
                // them at submit instead of silently creating a duplicate.
                if (!leads.some((x) => x.id === l.id)) adoptLead(l);
                fillFromLead(l);
              }}
              onBlur={() => fillFromCustomer(customer)}
            />
          </Field>
          <Field label="Phone" style={{ marginBottom: "0" }}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(925) 555-0123"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
            />
            {phoneError && (
              <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}>
                {phoneError}
              </p>
            )}
          </Field>
        </div>

        {/* Service address — the shared autocomplete, same as the customer sheet. A plain input
            here was the one address field in the app without suggestions. */}
        <Field label="Service address">
          <AddressInput value={addr} onChange={setAddr} placeholder="add the address" />
        </Field>

        {/* The staged details — a definition list of disclosure rows (front-desk
            RuleRow pattern): label · current value, one editor open at a time,
            everything in-flow. Title/type/customer/address above are the whole
            90% intake; these rows are the "one level down". Price is a terminal
            action, so it lives in the footer, not here. */}
        <div style={{ borderTop: "1px solid var(--line-2)", margin: "var(--space-2) 0 0" }}>
          <DisclosureRow
            label="Visits"
            value={visitsSummary}
            open={openRow === "visits"}
            onToggle={() => toggleRow("visits")}
          >
            <div>
              {visits.map((v, i) => (
                <div className="njvisit" key={i}>
                  <span className="njvisit-t">Visit {i + 1}</span>
                  <div className="njstepper">
                    <button type="button" onClick={() => nudgeVisit(i, -0.5)} aria-label="less time">
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0.25}
                      step={0.25}
                      value={v.h}
                      onChange={(e) => setVisitHours(i, e.target.value)}
                    />
                    <span className="u">h</span>
                    <button type="button" onClick={() => nudgeVisit(i, 0.5)} aria-label="more time">
                      +
                    </button>
                  </div>
                  {visits.length > 1 && (
                    <button
                      type="button"
                      className="njvisit-x"
                      onClick={() => removeVisitRow(i)}
                      aria-label="remove visit"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                marginTop: "var(--space-1)",
              }}
            >
              <span
                className="linklike"
                style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
                onClick={addVisitRow}
              >
                + Add a visit
              </span>
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                drag onto the Schedule to book
              </span>
            </div>
          </DisclosureRow>

          {/* ONE pool. The picker used to split into "Scoping" and "Before you leave", but the
              stage never survived attachment — a job stores {name, items} with no stage — so the
              split labelled a distinction nothing downstream acted on. */}
          {(
            <DisclosureRow
              label="Checklist"
              value={chkCurName}
              open={openRow === "chk" || chkIsBlank}
              onToggle={() => toggleRow("chk")}
            >
              <div className="njchklist">
                <button
                  type="button"
                  className={`njchk-row${!chkTpl ? " sel" : ""}`}
                  onClick={() => pickChecklist("")}
                >
                  <span className="njchk-dot">✓</span>
                  <span style={{ flex: 1 }}>No checklist</span>
                </button>
                {savedChecklists.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`njchk-row${chkTpl === c.id ? " sel" : ""}`}
                    onClick={() => pickChecklist(c.id)}
                  >
                    <span className="njchk-dot">✓</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <span className="muted" style={{ fontSize: "var(--type-sm)" }}>{c.items.length} items</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`njchk-build${chkIsBlank ? " sel" : ""}`}
                onClick={() => pickChecklist("blank")}
              >
                <span className="plus">+</span>Build from scratch
              </button>

              {chkIsBlank && (
                // THE SAME EDITOR the Checklists library and the job sheet use — name first, then
                // ordered steps, each explicitly a Check or a Photo. This screen had its own
                // builder: one text box and "Add item", no name, no way to say "this step is a
                // photo". Two editors for one thing, and the worse one was on the screen where
                // checklists actually get created.
                <div className="njbuilder">
                  <ChecklistStepsEditor
                    name={chkName}
                    onName={(n) => {
                      setChkName(n);
                      if (chkErr) setChkErr(null);
                    }}
                    items={chkItems}
                    onItems={setChkItems}
                  />
                  {chkErr ? (
                    <div
                      role="alert"
                      style={{ color: "var(--red-700)", fontSize: "var(--type-sm)" }}
                    >
                      {chkErr}
                    </div>
                  ) : null}
                </div>
              )}
            </DisclosureRow>
          )}

          {/* "Job notes", not "Notes" — this writes THIS job's notes and nothing else. The
              customer's own notes now show on the job sheet as their own row, so an
              unqualified "Notes" here would read as though it were writing those. */}
          <DisclosureRow
            label="Job notes"
            value={notesSummary}
            open={openRow === "notes"}
            onToggle={() => toggleRow("notes")}
          >
            {/* The paperclip sits IN the row — see the same note on the new-customer sheet.
                Only STAGED here: the upload URL is scoped to a job id that does not exist until
                this form is submitted, so the bytes go up once the job is persisted. */}
            <FieldGroup label="Job notes" groupClassName="cfrow" style={{ marginBottom: "0" }}>
              <input
                type="text"
                placeholder="gate code, what to bring…"
                aria-label="Job notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <StagedAttachButton staged={staged} busy={saving} />
            </FieldGroup>
            <StagedAttachStatus staged={staged} />
          </DisclosureRow>
        </div>


        {error && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{error}</p>
        )}

        {/* Sticky footer — the fork lives HERE, not in a Type chip: Cancel (quiet,
            intrinsic width) · Create job (bordered — no price yet) · Create & price it
            (filled primary — creates, then lands in Build the price; closing the builder
            still leaves the job — a nudge, not a wall). The two creates split the
            remaining width evenly and all three hold one 44px line. `.sheet-pri` is
            width:100% at the class level — correct for a foot it has to itself;
            `flex:1, width:auto` gives it its SHARE here instead. NOTE: this form
            deliberately has NO type="submit" control — Enter must never create the job
            (see the comment on the <form>). */}
        <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="btn ghost"
            style={{ flexShrink: 0, minHeight: 44 }}
            onClick={close}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
            onClick={() => void submitCreate(false)}
            disabled={saving}
          >
            {savingPath === "plain" ? "Creating…" : "Create job"}
          </button>
          <button
            type="button"
            className="sheet-pri"
            style={{ flex: 1, width: "auto", minHeight: 44, whiteSpace: "nowrap" }}
            onClick={() => void submitCreate(true)}
            disabled={saving}
          >
            {savingPath === "priced" ? "Creating…" : "Create & price it →"}
          </button>
        </div>
      </form>
    </div>
  );
}
