/**
 * components/modals/pricing/tech-quote-builder.tsx
 * The field on-site quote builder — extracted 1:1 from tech-quote-modal.tsx so
 * the SAME edit → present → sign machine renders in two homes:
 *   - the TECH_QUOTE modal (office "Price it on site →" — unchanged), and
 *   - the tech job view's Quote tab (estimating part 3), embedded in-flow.
 *
 * Faithful port of the prototype tech on-site quote builder in its TECH mode
 * (openTechQuote / tqRender with !fromCreate / tqSign / tqSigInit, prototype
 * 7230-7345) — the field screen where the tech prices a diagnosed repair, builds
 * Good/Better/Best, presents on glass, and captures the customer's signature.
 *
 * It is the SAME edit surface as the office single-tier PriceBuilderModal PLUS
 * three things the office one omits:
 *   (a) Good/Better/Best tiers + a "Give the customer choices?" opt-in
 *   (b) a "Present — on glass" tier-picker step (tqPresent / tqChoose)
 *   (c) an "Approve & sign" step with a real on-glass signature pad — commits
 *       the chosen tier via ONE v1.field.signQuote call (price + signature in
 *       the same transaction; part 1 records it as a real accepted estimate).
 *
 * Sheet grammar (#253): in the MODAL home every mode renders under a sticky
 * .sheet-head and docks its terminal action in a sticky .sheet-foot. EMBEDDED
 * (Quote tab), the host sheet already has its head (the customer), so the mode
 * headings render as in-flow .fsec-h lines instead — two stacked sticky heads
 * would fight for the same edge. The .sheet-foot stays: the host suppresses its
 * own foot while this builder is on screen, so there is still exactly ONE.
 *
 * All builder state is LOCAL React state (the prototype's global state.tq). The
 * store is read via raw selectors (jobs / leads / services / laborRates, never
 * derived in the selector); the only commit is signJobQuote at sign time.
 */

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SignaturePad } from "@/components/shared/signature-pad";
import { authorizationText } from "@/modules/quoting/domain/authorization-text";
import { useAppStore } from "@/lib/store/app-store";
import { jobPriceCommitted } from "@/features/jobs/job-status-meta";
import type { Service } from "@/lib/store/types";
import type { LaborRate as StoreLaborRate } from "@/lib/store/slices/settings-slice";
import {
  type AddSub,
  type BuildLine,
  type LaborRate,
  type PricebookItem,
  AddToQuoteRow,
  AddMenu,
  LineRow,
  custLabel,
  lineAmt,
  linesTotal,
  seedLines,
} from "./build-line";
import { fmt$, fmt$2 } from "@/lib/format";
import {
  FieldPricingRows,
  PriceBreakdown,
  NO_FIELD_PRICING,
  fieldPricingRates,
  fieldPricingTotals,
  hasFieldPricing,
  type FieldPricing,
} from "./field-pricing";

// ---- tier model (prototype TQ_TIERS / state.tq) ----------------------------

type Tier = "good" | "better" | "best";

const TQ_TIERS: ReadonlyArray<readonly [Tier, string]> = [
  ["good", "Good"],
  ["better", "Better"],
  ["best", "Best"],
];

type TierLines = Record<Tier, BuildLine[]>;
type TierUse = Record<Tier, boolean>;

export type TechQuoteMode = "edit" | "present" | "sign";

/** Label for a tier (prototype TQ_TIERS lookup). */
function tierLabel(t: Tier): string {
  const found = TQ_TIERS.find(([k]) => k === t);
  return found ? found[1] : t;
}

/**
 * Mode heading. Modal home: the sticky .sheet-head frame. Embedded: an in-flow
 * section heading — the host sheet already owns the sticky head.
 */
function ModeHead({
  title,
  custName,
  embedded,
  meta = "Price the repair",
}: {
  title: string;
  custName: string;
  embedded: boolean;
  /** The modal home's meta line — a committed job is adding found work, not pricing. */
  meta?: string;
}) {
  if (embedded) {
    return (
      <div className="fsec-h" style={{ marginTop: "var(--space-2)" }}>
        <span>{title}</span>
        <span className="muted" style={{ fontWeight: 500 }}>
          {custName}
        </span>
      </div>
    );
  }
  return (
    <div className="sheet-head">
      <h2>{title}</h2>
      <div className="sheet-meta">
        <span>
          {meta} · {custName}
        </span>
      </div>
    </div>
  );
}

interface ChoicesRowProps {
  /** The cheaper tier is not yet opted into — offer it. */
  showGood: boolean;
  /** The premium tier is not yet opted into — offer it. */
  showBest: boolean;
  onAddGood: () => void;
  onAddBest: () => void;
}

/**
 * The good/better/best opt-in — ONE row whose actions ARE the row: the question on the left,
 * "+ Cheaper / + Premium" on the right. It shipped as a "Set up →" disclosure whose entire
 * content was those same two buttons — a step that existed only to be an extra step (Owen:
 * "that's terrible design"). Each tap opts that tier in directly, seeded as a copy of the
 * current price, exactly as before; a tier already on drops its button, and with both on the
 * caller removes the row.
 */
function ChoicesRow({ showGood, showBest, onAddGood, onAddBest }: ChoicesRowProps) {
  return (
    <div className="tqchoice">
      <div className="tqchoice-row">
        <span className="jaddr-t">
          Give the customer choices?
          <span className="jaddr-s">Each option starts as a copy of this price</span>
        </span>
        <span className="tqchoice-acts">
          {showGood ? (
            <button type="button" className="chip ghost" onClick={onAddGood}>
              + Cheaper
            </button>
          ) : null}
          {showBest ? (
            <button type="button" className="chip ghost" onClick={onAddBest}>
              + Premium
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

interface SignBlockProps {
  signerName: string;
  signatureSvg: string;
  signing: boolean;
  signError: string | null;
  onName: (v: string) => void;
  onSignature: (svg: string) => void;
  onBack: () => void;
  onSign: () => void;
  signLabel: string;
}

/**
 * The signature capture — name, pad, error, and the ← Back / sign foot. ONE chunk for both
 * signings (the quote's Accept & sign and the change order's Approve & sign): the ceremony is
 * identical, only the words above it and the write behind it differ.
 */
function SignBlock({
  signerName,
  signatureSvg,
  signing,
  signError,
  onName,
  onSignature,
  onBack,
  onSign,
  signLabel,
}: SignBlockProps) {
  return (
    <>
      <label
        htmlFor="tq-signer-name"
        style={{ display: "block", fontSize: "var(--type-sm)", fontWeight: 700, marginBottom: "var(--space-1)" }}
      >
        Customer&rsquo;s full name
      </label>
      <input
        id="tq-signer-name"
        type="text"
        value={signerName}
        maxLength={120}
        autoComplete="off"
        disabled={signing}
        onChange={(ev) => onName(ev.target.value)}
        style={{
          width: "100%",
          border: "1.5px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "inherit",
          fontSize: "var(--type-base)",
          background: "var(--card)",
          color: "var(--ink)",
          boxSizing: "border-box",
          marginBottom: "var(--space-3)",
        }}
      />

      <span style={{ display: "block", fontSize: "var(--type-sm)", fontWeight: 700, marginBottom: "var(--space-1)" }}>
        Customer signature
      </span>
      {/* The same pad the web quote page uses, so one stored format renders in one viewer. */}
      <SignaturePad value={signatureSvg} disabled={signing} aria-label="Customer signature" onChange={onSignature} />

      {signError ? (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{signError}</p>
      ) : null}

      {/* Sticky foot — ONE filled primary (the on-glass confirm); Back stays a quiet ghost. */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button className="btn ghost" onClick={onBack} disabled={signing} style={{ flexShrink: 0 }}>
          ← Back
        </button>
        <button
          className="sheet-pri"
          onClick={onSign}
          disabled={signing}
          style={{ flex: 1, opacity: signing ? 0.45 : undefined }}
        >
          {signLabel}
        </button>
      </div>
    </>
  );
}

export interface TechQuoteBuilderProps {
  jobId: string | undefined;
  /** Called after a successful sign (and by nothing else) — the host decides where to land. */
  onSigned: () => void;
  /** In-flow inside another sheet (the Quote tab) — mode headings render in-flow, not sticky. */
  embedded?: boolean;
  /** Fires on every edit ⇄ present ⇄ sign transition so an embedding host can hide its
   *  surrounding sections while the phone is handed to the customer. */
  onModeChange?: (mode: TechQuoteMode) => void;
}

// ---- the builder ------------------------------------------------------------

export function TechQuoteBuilder({ jobId, onSigned, embedded = false, onModeChange }: TechQuoteBuilderProps) {
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const signJobQuote = useAppStore((s) => s.signJobQuote);
  const signChangeOrder = useAppStore((s) => s.signChangeOrder);
  const addAddonField = useAppStore((s) => s.addAddonField);
  const brand = useAppStore((s) => s.brand);
  const servicesRaw = useAppStore((s) => s.services);
  const laborRatesRaw = useAppStore((s) => s.laborRates);

  const pricebook: PricebookItem[] = useMemo(
    () =>
      [...servicesRaw]
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((svc: Service) => ({ d: svc.name, r: svc.unitPrice, c: svc.cost })),
    [servicesRaw],
  );
  const laborRates: LaborRate[] = useMemo(
    () => laborRatesRaw.map((r: StoreLaborRate) => ({ name: r.name, rate: r.rate, kind: r.kind })),
    [laborRatesRaw],
  );

  const job = jobs.find((j) => j.id === jobId);
  /**
   * IS THE PRICE ON THIS JOB COMMITTED? Two ways it becomes so — the customer SIGNED
   * (`sourceEstimateId`, stamped by both directions of a sale: an office quote accepted into a
   * job, and a field sign) or the office BOOKED it (lines saved on a non-estimate job; the
   * customer agreed on the phone). Either way this builder is NOT a quote editor any more: the
   * price is a document someone stands behind, and a technician adding work is writing a CHANGE
   * ORDER — the found-work addendum. Editing the committed lines themselves is the office's
   * correction (the job sheet's Build the price).
   *
   * The one case that stays editable: lines on an ESTIMATE-kind job — the technician's own
   * in-progress draft (the unmount stash below writes those), which nobody has promised yet.
   */
  const committed = job ? jobPriceCommitted(job) : false;
  /** Signed, specifically — picks the WORDS ("Sold — signed" vs "Booked") and the CO sentence. */
  const signedSold = Boolean(job?.sourceEstimateId);

  // ---- LOCAL builder state (prototype state.tq) -----------------------------
  // better is seeded from the job's existing lines; good/best start empty and
  // opt-in. `use.better` is always on. `picking` opens the add menu when better
  // has no seed lines. `mode` drives edit → present → sign.
  // CO mode starts EMPTY — the committed lines are a document to read back, not a draft to reseed.
  const seed = useMemo(() => (job && !committed ? seedLines(job) : []), [job, committed]);

  const [tiers, setTiers] = useState<TierLines>(() => ({
    good: [],
    better: seed.map((l) => ({ ...l })),
    best: [],
  }));
  const [use, setUse] = useState<TierUse>({ good: false, better: true, best: false });
  const [tier, setTier] = useState<Tier>("better");
  const [mode, setMode] = useState<TechQuoteMode>("edit");
  const [chosen, setChosen] = useState<Tier | null>(null);
  const [picking, setPicking] = useState<boolean>(() => !committed && seed.length === 0);
  const [add, setAdd] = useState<AddSub>(null);
  // Surfaced when the on-site price fails to persist — the sign view stays open
  // so the tech can retry rather than closing on a lost price (no silent fail).
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const [signerName, setSignerName] = useState("");
  const [signatureSvg, setSignatureSvg] = useState("");

  // Discount / tax / deposit, shared by every tier: they describe the DOCUMENT, not one option on
  // it, exactly as the office composer's single pricing block does for a GBB quote.
  // Seeded from the JOB's stored rates when it carries any — a stashed draft's discount and tax
  // come back with its lines (they used to reset to zero on resume while the lines survived).
  const [pricing, setPricing] = useState<FieldPricing>(() =>
    job?.pricing && (job.pricing.disc > 0 || job.pricing.tax > 0)
      ? {
          ...NO_FIELD_PRICING,
          discPct: job.pricing.disc,
          taxPct: job.pricing.tax,
        }
      : NO_FIELD_PRICING,
  );

  // The shop's default sales-tax rate, seeded ONCE onto a fresh quote the way a new office quote
  // seeds it — same org setting, same rule, so one document does not depend on where it was born.
  // Never over a rate the tech has already typed; a shop with no rate on file gets 0 and this does
  // nothing.
  //
  // Read from the STORE rather than queried here: this component renders in two homes and the
  // hydrators already own settings reads (SettingsHydrator for owner/office, FieldTogglesHydrator
  // for technicians, whose `fieldPricingDefaults` read exists precisely because settings.get is
  // ownerOrOffice). A query inside the builder would also make every surface that renders it
  // require a tRPC provider.
  const orgTaxRate = useAppStore((s) => s.taxRate);
  const seededOrgTax = useRef(false);
  useEffect(() => {
    if (seededOrgTax.current || orgTaxRate <= 0) return;
    seededOrgTax.current = true;
    setPricing((prev) => (prev.taxPct > 0 ? prev : { ...prev, taxPct: orgTaxRate }));
  }, [orgTaxRate]);

  /**
   * SAVE THE PRICE WHEN THE TECHNICIAN LEAVES IT.
   *
   * The builder's lines were local React state and `signJobQuote` was the only way out of this
   * component, so pricing a repair and then switching to the Job tab — or closing the sheet, or
   * having iOS reap the tab — threw every line away without a word. On a phone in a truck that is
   * an ordinary thing to do.
   *
   * On UNMOUNT, not on every keystroke: a debounced autosave writes half-typed prices to the job
   * from a moving vehicle, and this surface is the one place a technician is standing in front of
   * a customer. Leaving the tab is the moment the edit is finished.
   *
   * Refs, not deps: the cleanup has to read the LAST lines rather than the ones present when the
   * effect was declared, and re-declaring it per keystroke would fire a save on every change.
   */
  const draftRef = useRef<{ lines: BuildLine[]; pricing: FieldPricing }>({ lines: [], pricing: NO_FIELD_PRICING });
  draftRef.current = { lines: tiers[tier], pricing };
  /** Set once the customer signs — signQuote has already written these lines, so the unmount
   *  save must not fire and re-write them as an unsigned draft a moment later. */
  const soldRef = useRef(false);
  /** What the job already held. An unmodified visit to the tab must write nothing at all. */
  const seedKeyRef = useRef("");
  const lineKey = (ls: readonly BuildLine[]): string =>
    ls.map((l) => `${l.d}|${lineAmt(l)}`).join("~");
  if (seedKeyRef.current === "") seedKeyRef.current = lineKey(seed);

  const saveQuoteDraft = useAppStore((s) => s.saveQuoteDraft);
  const jobIdRef = useRef<string | undefined>(undefined);
  jobIdRef.current = job?.id;
  const coRef = useRef(false);
  coRef.current = committed;
  useEffect(() => {
    return () => {
      const id = jobIdRef.current;
      if (!id || soldRef.current) return;
      const { lines: current, pricing: rates } = draftRef.current;
      // Nothing the technician did changed the price — writing would be a pointless round trip
      // and would stamp the job as edited when it was only looked at.
      if (lineKey(current) === seedKeyRef.current) return;

      // A COMMITTED job's unsigned lines are found work, not a price draft — saveQuoteDraft
      // would overwrite the booked/signed document. Stash them as PROPOSED add-ons: they surface
      // in Found work with the office OK flow, and the next change order picks them up.
      if (coRef.current) {
        for (const l of current) {
          const d = l.d.trim();
          const r = lineAmt(l);
          if (d && r > 0) addAddonField(id, { d, r });
        }
        return;
      }

      const wireLines = current
        .map((l) => ({ d: l.d || "Repair", q: 1, r: lineAmt(l) }))
        .filter((l) => (l.r ?? 0) > 0)
        .map((l) => ({
          description: l.d,
          quantity: l.q,
          rateCents: Math.round(l.r * 100),
          costCents: 0,
        }));
      const subtotalCents = wireLines.reduce((sum, l) => sum + Math.round(l.quantity * l.rateCents), 0);
      // Fire and forget: the component is already gone, so there is nothing left to show a
      // spinner on. A refusal still reaches the user — the store reports it through
      // WriteErrorToast and rolls the optimistic lines back.
      void saveQuoteDraft(id, { lines: wireLines, ...fieldPricingRates(rates, subtotalCents) });
    };
  }, [saveQuoteDraft, addAddonField]);

  // Mode transitions notify the host (effect, not in-setter, so a re-render
  // during another component's render never fires a parent state update).
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  if (!job) return null;

  const lead = leads.find((l) => l.id === job.leadId);
  const custName = custLabel(job, lead);

  const tierTotal = (t: Tier): number => linesTotal(tiers[t]);
  const multi = use.good || use.best; // tier chips appear once they opt into choices

  // ---- immutable tier-line ops (never mutate a line or tier array) ----------

  function setTierLines(t: Tier, next: (prev: BuildLine[]) => BuildLine[]) {
    setTiers((prev) => ({ ...prev, [t]: next(prev[t]) }));
  }

  function appendLine(l: BuildLine) {
    setTierLines(tier, (prev) => [...prev, l]);
  }

  function pickBook(item: PricebookItem) {
    appendLine({ kind: "book", d: item.d, amt: item.r, c: item.c ?? 0 });
  }

  function addCustom() {
    appendLine({ kind: "custom", d: "", amt: 0 });
    setAdd(null);
  }

  function pickRate(r: LaborRate) {
    if (r.kind === "flat_fee") {
      appendLine({ kind: "custom", d: r.name, amt: r.rate });
    } else {
      appendLine({ kind: "tm", d: "Labor", h: 1, rate: r.rate });
    }
  }

  function addCustomLabor() {
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: 0 });
    setAdd(null);
  }

  function setLine(index: number, patch: Partial<BuildLine>) {
    setTierLines(tier, (prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setTierLines(tier, (prev) => prev.filter((_, i) => i !== index));
  }

  // ---- tier ops (prototype tqTier / tqToggle) -------------------------------

  function selectTier(t: Tier) {
    setTier(t);
    setPicking(false);
  }

  // tqToggle — turning a tier on copies the current better lines into it (only
  // when empty) and switches to it; turning the active tier off reverts to better.
  function toggleTier(t: Tier) {
    if (t === "better") return;
    const turningOn = !use[t];
    setUse((prev) => ({ ...prev, [t]: turningOn }));
    if (turningOn) {
      setTiers((prev) => ({
        ...prev,
        [t]: prev[t].length ? prev[t] : prev.better.map((l) => ({ ...l })),
      }));
      setTier(t);
    } else if (tier === t) {
      setTier("better");
    }
  }

  // ---- present / choose (prototype tqPresent / tqChoose) --------------------

  const offered = TQ_TIERS.filter(([k]) => use[k] && tiers[k].length);

  function present() {
    if (offered.length <= 1) {
      const only = offered[0]?.[0] ?? "better";
      setChosen(only);
      setMode("sign");
    } else {
      setMode("present");
    }
    setPicking(false);
  }

  function choose(t: Tier) {
    setChosen(t);
    setMode("sign");
  }

  // ---- sign (prototype tqSign) ----------------------------------------------
  // Commit the chosen tier's lines + the signature via ONE v1.field.signQuote
  // call (same tx server-side; recorded as an accepted estimate by part 1).

  const chosenTier: Tier = chosen ?? "better";

  // ---- change order (committed job — booked or signed) -----------------------
  // The CO's items: add-ons already PROPOSED on the job (found work queued by the office or a
  // prior session — they are on the glass, so they are in the approval), plus the lines typed
  // here. `dbId` present = the server knows the row; a still-persisting optimistic add-on is
  // excluded rather than signed for by an id the server would refuse.
  const proposedAddons = (job?.addons ?? []).filter((a) => a.status === "proposed" && a.dbId);
  const coLines = tiers.better.filter((l) => l.d.trim() && lineAmt(l) > 0);
  const coTotal =
    proposedAddons.reduce((sum, a) => sum + (a.r ?? 0) * (a.q ?? 1), 0) + linesTotal(coLines);
  const coCount = proposedAddons.length + coLines.length;
  const committedTotal = (job?.lines ?? []).reduce((sum, l) => sum + (l.r ?? 0) * (l.q ?? 1), 0);
  // A redacted device (techSeesPrice off) reads null rates — never print those as $0.
  const committedRedacted = (job?.lines ?? []).some((l) => l.r == null);

  async function signCO() {
    if (!job || signing) return;
    const name = signerName.trim();
    if (!name) {
      setSignError("Type the customer's name to sign.");
      return;
    }
    if (coCount === 0) {
      setSignError("Add the extra work first.");
      return;
    }
    setSigning(true);
    setSignError(null);
    soldRef.current = true; // the CO commits its lines itself — the unmount stash must stand down
    const { ok, error } = await signChangeOrder(job.id, {
      lines: coLines.map((l) => ({ description: l.d, rateCents: Math.round(lineAmt(l) * 100) })),
      includeAddonDbIds: proposedAddons.map((a) => a.dbId!),
      signerName: name,
      ...(signatureSvg ? { signatureSvg } : {}),
    });
    setSigning(false);
    if (!ok) {
      soldRef.current = false;
      setSignError(error ?? "Couldn't save the approval — check your connection and try again.");
      return;
    }
    onSigned();
  }

  async function sign() {
    if (!job || signing) return;
    if (committed) return signCO();
    const name = signerName.trim();
    if (!name) {
      setSignError("Type the customer's name to sign.");
      return;
    }
    const jobLines = tiers[chosenTier]
      .map((l) => ({ d: l.d || "Repair", q: 1, r: lineAmt(l) }))
      .filter((l) => (l.r ?? 0) > 0);
    if (jobLines.length === 0) {
      setSignError("Add a price before signing.");
      return;
    }
    setSigning(true);
    setSignError(null);
    const wireLines = jobLines.map((l) => ({
      description: l.d,
      quantity: l.q ?? 1,
      rateCents: Math.round((l.r ?? 0) * 100),
      costCents: 0,
    }));
    // Derived from the SAME line set being sent, so the rates cannot describe a different subtotal
    // from the one the server will run them against.
    const rates = fieldPricingRates(
      pricing,
      wireLines.reduce((sum, l) => sum + Math.round(l.quantity * l.rateCents), 0),
    );
    soldRef.current = true;
    const { ok, error } = await signJobQuote(job.id, {
      lines: wireLines,
      signerName: name,
      // Omitted when nothing was drawn: the typed name IS the signature, and "" would be a
      // different, emptier record than "they signed without drawing".
      ...(signatureSvg ? { signatureSvg } : {}),
      ...rates,
    });
    setSigning(false);
    if (!ok) {
      // The sale did not happen, so the price is a DRAFT again — clear the flag or the unmount
      // save would be suppressed and a failed signature would still lose the lines.
      soldRef.current = false;
      setSignError(error ?? "Couldn't save the signature — check your connection and try again.");
      return;
    }
    onSigned();
  }

  const anyPriced = tierTotal("better") > 0 || tierTotal("good") > 0 || tierTotal("best") > 0;

  // ---- SIGN mode ------------------------------------------------------------
  if (mode === "sign") {
    const signLines = tiers[chosenTier];
    // CHANGE ORDER signing shares this screen's chrome (name, pad, foot) and swaps the substance:
    // the items are the ADDITION (proposed add-ons + the lines typed here), the figure is the
    // change-order total, and the sentence names an addition to a signed job — no doc rates,
    // which belong to the document already signed.
    if (committed) {
      return (
        <>
          <ModeHead title="Sign change order" custName={custName} embedded={embedded} />

          <div className="card" style={{ background: "var(--manila)" }}>
            {proposedAddons.map((a2) => (
              <div
                key={a2.dbId}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
              >
                <span>{a2.d}</span>
                <b className="fig">{fmt$2((a2.r ?? 0) * (a2.q ?? 1))}</b>
              </div>
            ))}
            {coLines.map((l, i) => (
              <div
                key={i}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
              >
                <span>{l.d}</span>
                <b className="fig">{fmt$2(lineAmt(l))}</b>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                fontSize: "var(--type-lg)",
                borderTop: "1px solid var(--manila-line)",
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
              }}
            >
              <span>Change order</span>
              <span className="fig">{fmt$2(coTotal)}</span>
            </div>
            {!committedRedacted && (
              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", color: "var(--ink-2)", paddingTop: "var(--space-1)" }}
              >
                <span>New job total</span>
                <span className="fig">{fmt$2(committedTotal + coTotal)}</span>
              </div>
            )}
          </div>

          {/* Signed jobs name the prior signature; a BOOKED job has none to name — same
              approval, honest sentence either way. */}
          <div
            className="muted"
            style={{ fontSize: "var(--type-sm)", margin: "var(--space-4) 0 var(--space-3)", lineHeight: 1.55 }}
          >
            {signedSold
              ? `The customer approves adding the work listed above, at the price shown, to the job they already signed with ${brand.name}. It bills with the job.`
              : `The customer approves adding the work listed above, at the price shown, to this job with ${brand.name}. It bills with the job.`}
          </div>

          <SignBlock
            signerName={signerName}
            signatureSvg={signatureSvg}
            signing={signing}
            signError={signError}
            onName={(v) => {
              setSignerName(v);
              if (signError) setSignError(null);
            }}
            onSignature={(v) => {
              setSignatureSvg(v);
              if (signError) setSignError(null);
            }}
            onBack={() => setMode("edit")}
            onSign={() => void sign()}
            signLabel={signing ? "Saving…" : `Approve & sign — ${fmt$2(coTotal)}`}
          />
        </>
      );
    }
    // Cent-precise from here down. This is the document, and every figure on it has to be the one
    // inside the sentence — a total rounded to whole dollars beside a sentence naming cents is two
    // different numbers on one screen.
    const subtotalCents = Math.round(tierTotal(chosenTier) * 100);
    const signRates = fieldPricingRates(pricing, subtotalCents);
    const signTotals = fieldPricingTotals(pricing, subtotalCents);
    const priced = hasFieldPricing(signRates);
    return (
      <>
        <ModeHead title="Approve & sign" custName={custName} embedded={embedded} />

        <div className="card" style={{ background: "var(--manila)" }}>
          {signLines.map((l, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
            >
              <span>{l.d || "Repair"}</span>
              <b className="fig">{fmt$2(lineAmt(l))}</b>
            </div>
          ))}
          {priced ? (
            <PriceBreakdown totals={signTotals} rates={signRates} ruleColor="var(--manila-line)" />
          ) : (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                fontSize: "var(--type-lg)",
                borderTop: "1px solid var(--manila-line)",
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
              }}
            >
              <span>Total</span>
              <span className="fig">{fmt$2(signTotals.total / 100)}</span>
            </div>
          )}
        </div>

        {/* The sentence the customer is agreeing to — rendered from the SAME function the server
            stores, off the SAME chain that produced the figures above, so the words on the tablet,
            the numbers above them and the frozen record cannot diverge. */}
        <div
          className="muted"
          style={{ fontSize: "var(--type-sm)", margin: "var(--space-4) 0 var(--space-3)", lineHeight: 1.55 }}
        >
          {authorizationText({
            totalCents: signTotals.total,
            depositCents: signTotals.depositDue,
            orgName: brand.name,
          })}
        </div>

        <SignBlock
          signerName={signerName}
          signatureSvg={signatureSvg}
          signing={signing}
          signError={signError}
          onName={(v) => {
            setSignerName(v);
            if (signError) setSignError(null);
          }}
          onSignature={(v) => {
            setSignatureSvg(v);
            if (signError) setSignError(null);
          }}
          onBack={() => setMode(offered.length > 1 ? "present" : "edit")}
          onSign={() => void sign()}
          signLabel={signing ? "Saving…" : `Accept & sign — ${fmt$2(signTotals.total / 100)}`}
        />
      </>
    );
  }

  // ---- PRESENT mode ---------------------------------------------------------
  if (mode === "present") {
    const firstName = custName.split(" ")[0] ?? custName;
    // The customer picks from these cards and signs the next screen. Whatever is on the card has to
    // be the figure on that screen, so the tier prices carry the document's rates too — a card
    // showing the pre-tax option price would be a number nobody ends up paying.
    const offeredTotal = (t: Tier): number =>
      fieldPricingTotals(pricing, Math.round(tierTotal(t) * 100)).total / 100;
    return (
      <>
        <ModeHead title="Present — on glass" custName={custName} embedded={embedded} />
        <div className="muted" style={{ fontSize: "var(--type-base)", marginBottom: "var(--space-3)" }}>
          Hand {firstName} the {embedded ? "phone" : "tablet"} — they pick:
        </div>

        {offered.length ? (
          offered.map(([k, lbl]) => (
            <div
              key={k}
              className="card clickable"
              onClick={() => choose(k)}
              style={{
                marginBottom: "var(--space-2)",
                cursor: "pointer",
                ...(k === "better" ? { borderColor: "var(--green-600)" } : {}),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b>
                  {lbl}
                  {k === "better" ? " · recommended" : ""}
                </b>
                <b className="fig">{fmt$2(offeredTotal(k))}</b>
              </div>
              <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)" }}>
                {tiers[k].map((l) => l.d || "Repair").join(" · ")}
              </div>
            </div>
          ))
        ) : (
          <div className="muted">Nothing priced yet.</div>
        )}

        {/* No .sheet-foot here on purpose: the tier cards above are equal peer
            choices — there is no single terminal action to promote. */}
        <div style={{ textAlign: "right", marginTop: "var(--space-2)" }}>
          <button className="btn" onClick={() => setMode("edit")}>
            ← Back to edit
          </button>
        </div>
      </>
    );
  }

  // ---- EDIT mode ------------------------------------------------------------
  const lines = tiers[tier];

  const tierChips = TQ_TIERS.filter(([k]) => k === "better" || use[k]);
  const showGoodOpt = !use.good;
  const showBestOpt = !use.best;

  // The active tier's derivation, so the tech sees the effect of a rate on the option he is
  // editing. The rates themselves are shared across tiers — they describe the document.
  const editSubtotalCents = Math.round(tierTotal(tier) * 100);
  const editRates = fieldPricingRates(pricing, editSubtotalCents);
  const editTotals = fieldPricingTotals(pricing, editSubtotalCents);
  const editPriced = hasFieldPricing(editRates);

  return (
    <>
      {/* Embedded, the Quote tab's own "The price" section header frames the edit
          surface — a second "Build the price" heading would say it twice. In the MODAL home a
          committed job is not building a price — the surface is the change order. */}
      {!embedded && (
        <ModeHead
          title={committed ? "Change order" : "Build the price"}
          meta={committed ? "Add found work" : "Price the repair"}
          custName={custName}
          embedded={false}
        />
      )}

      {/* THE COMMITTED DOCUMENT — read-back, not a draft. A booked or signed price is not this
          surface's to edit (that correction is the office's Build the price); it is here so the
          change order below is read against the thing it changes. "Booked" = the office saved
          the price (the customer agreed on the phone); "Sold — signed" = a signature stands
          behind it. Null rates are a redacted device, never $0. */}
      {committed ? (
        <>
          <div className="fsec" style={{ marginBottom: 0 }}>
            <div className="fsec-h">
              <span>{signedSold ? "Sold — signed" : "Booked"}</span>
              <span className="fig">{committedRedacted ? "" : fmt$2(committedTotal)}</span>
            </div>
          </div>
          <div className="card" style={{ marginBottom: "var(--space-4)" }}>
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
          <div className="fsec" style={{ marginBottom: 0 }}>
            <div className="fsec-h">
              <span>Change order</span>
            </div>
          </div>
        </>
      ) : null}

      {/* tier chips (only better + opted-in tiers; each shows label · $total) */}
      {multi && !committed ? (
        <div className="chips" style={{ marginBottom: "var(--space-3)" }}>
          {tierChips.map(([k, lbl]) => {
            const t = tierTotal(k);
            return (
              <button
                key={k}
                className={`chip ${tier === k ? "sel" : ""}`}
                onClick={() => selectTier(k)}
              >
                {lbl}
                {t ? ` · ${fmt$(t)}` : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* THE PRICE CARD — the lines, the one way to add to them, and the Total.
          It renders even with nothing in it. It used to be hidden until the first line existed,
          which is precisely why the add control had to live outside it and ended up stranded
          below the discount rows. An empty card holding the invitation to act is the house's
          own first-run shape, and it keeps the control in the same place all the way through. */}
      <div className="card" style={{ marginBottom: "var(--space-4)" }}>
        {/* Found work already PROPOSED on the job — queued by the office or a prior session. It
            is on the glass when the customer signs, so it is in the change order; fixed rows,
            because these are persisted records with their own edit surface (Found work). */}
        {committed
          ? proposedAddons.map((a2) => (
              <div
                key={a2.dbId}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0", color: "var(--ink-2)" }}
              >
                <span>{a2.d} · waiting for OK</span>
                <b className="fig">{fmt$2((a2.r ?? 0) * (a2.q ?? 1))}</b>
              </div>
            ))
          : null}
        {lines.map((l, i) => (
          <LineRow
            key={i}
            line={l}
            onSet={(patch) => setLine(i, patch)}
            onRemove={() => removeLine(i)}
          />
        ))}
        {/* Picking happens IN the card, under the lines it is about — the four paths replace the
            control that opened them rather than pushing the list around it. */}
        {picking ? (
          <AddMenu
            sub={add}
            hasLines={lines.length > 0}
            pricebook={pricebook}
            laborRates={laborRates}
            onSetSub={setAdd}
            onPickBook={pickBook}
            onAddCustom={addCustom}
            onPickRate={pickRate}
            onAddCustomLabor={addCustomLabor}
            onDone={() => setPicking(false)}
          />
        ) : (
          <AddToQuoteRow
            onOpen={() => {
              setAdd(null);
              setPicking(true);
            }}
          />
        )}
        {/* With nothing set the subtotal IS the total, and a four-row derivation of one number
            is noise — the list keeps its single Total line exactly as before. The moment a rate
            is set the arithmetic becomes the customer's business and it is shown in full.
            An empty quote has no Total at all: nothing has been priced, so there is no figure
            to state and a $0 would be a claim about the job rather than a fact about the list. */}
        {committed && coCount > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                fontSize: "var(--type-lg)",
                borderTop: "1px solid var(--line)",
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
              }}
            >
              <span>Change order</span>
              <span className="fig">{fmt$2(coTotal)}</span>
            </div>
            {!committedRedacted && (
              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", color: "var(--ink-2)", paddingTop: "var(--space-1)" }}
              >
                <span>New job total</span>
                <span className="fig">{fmt$2(committedTotal + coTotal)}</span>
              </div>
            )}
          </>
        ) : committed ? null : lines.length === 0 ? null : editPriced ? (
          <PriceBreakdown totals={editTotals} rates={editRates} ruleColor="var(--line)" />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 800,
              fontSize: "var(--type-lg)",
              borderTop: "1px solid var(--line)",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-2)",
            }}
          >
            <span>{multi ? `${tierLabel(tier)} total` : "Total"}</span>
            <span className="fig">{fmt$(tierTotal(tier))}</span>
          </div>
        )}
      </div>

      {/* Discount / sales tax / deposit — three collapsed rows, one open at a time, appearing only
          once a line is priced. See field-pricing.tsx for why this is not the office's three-across
          card: a technician on a doorstep needs one of these, usually none, and the collapsed value
          is the whole summary. */}
      {anyPriced && !committed ? (
        <FieldPricingRows
          pricing={pricing}
          subtotalCents={Math.round(tierTotal(tier) * 100)}
          onChange={setPricing}
        />
      ) : null}

      {/* The add control used to sit HERE, below the discount rows — outside the card whose total
          it fed, and beneath the three rows that modify that total. It lives in the card now. */}

      {/* "Give the customer choices?" — once anything is priced and not all opted */}
      {anyPriced && !committed && (showGoodOpt || showBestOpt) ? (
        <ChoicesRow
          showGood={showGoodOpt}
          showBest={showBestOpt}
          onAddGood={() => toggleTier("good")}
          onAddBest={() => toggleTier("best")}
        />
      ) : null}

      {/* Sticky foot — ONE filled primary docked where the thumb is: present to
          customer (single) / present options (multi). */}
      <div className="sheet-foot">
        <button
          className="sheet-pri"
          onClick={present}
          disabled={committed ? coCount === 0 : !anyPriced}
          style={(committed ? coCount > 0 : anyPriced) ? undefined : { opacity: 0.45 }}
        >
          {committed ? "Present change order →" : multi ? "Present options →" : "Present to customer →"}
        </button>
      </div>
    </>
  );
}
