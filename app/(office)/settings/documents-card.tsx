"use client";

/**
 * Settings → Workspace → "Documents".
 *
 * The wording slots on customer documents: the invoice footer (all three invoice surfaces),
 * the payment-instructions and receipt lines (the public /i/<token> page), and the
 * change-order agreement line (the tech's sign screen). One quiet row per slot; a row expands
 * in-flow to a textarea seeded with the CURRENT EFFECTIVE sentence and saves only itself.
 *
 * TWO rules keep the standard wording alive:
 *   - text identical to the standard sentence saves as NULL, so opening a row and hitting
 *     Save does not freeze today's standard into an override;
 *   - blank saves as NULL — an override can never be an empty line where a sentence belongs.
 *
 * WHAT IS DELIBERATELY NOT HERE: the quote/field-sale authorization sentence. It is legal
 * text, versioned and frozen verbatim into every signature snapshot
 * (modules/quoting/domain/authorization-text.ts) — not the shop's to edit.
 *
 * Sits beside Branding and Business details on purpose: all three answer "what does the
 * customer see". Own file + own test, matching branding-card and business-identity-card.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { userMessage } from "@/lib/trpc/error-map";
import { FoldCard } from "./fold-card";
import { MarkDocuments } from "./setting-marks";
import {
  defaultPayInstructions,
  defaultReceiptNote,
  defaultChangeOrderAgreement,
  INVOICE_FOOTER_MAX,
  PAY_INSTRUCTIONS_MAX,
  RECEIPT_NOTE_MAX,
  CHANGE_ORDER_AGREEMENT_MAX,
} from "@/modules/settings/domain/document-wording";

const TITLE = "Documents";

type SlotKey = "invoiceFooter" | "payInstructions" | "receiptNote" | "changeOrderAgreement";

interface Slot {
  readonly key: SlotKey;
  /** Plain trade vocabulary — what the line is, not where it lives in the code. */
  readonly label: string;
  /** One sentence saying where the line shows up. */
  readonly hint: string;
  readonly max: number;
  /**
   * Every sentence that counts as "standard" for this slot, given the shop's name. Empty for
   * the footer (no standard footer exists). The FIRST entry seeds the textarea; saving text
   * equal to ANY entry stores null so the standard is never frozen into an override.
   */
  readonly standards: (brandName: string) => readonly string[];
}

const SLOTS: readonly Slot[] = [
  {
    key: "invoiceFooter",
    label: "Invoice footer",
    hint: "Closing line at the bottom of every invoice — a thank-you or warranty note.",
    max: INVOICE_FOOTER_MAX,
    standards: () => [],
  },
  {
    key: "payInstructions",
    label: "Payment instructions",
    hint: "Shown on the customer's invoice page when card payment isn't available.",
    max: PAY_INSTRUCTIONS_MAX,
    standards: (name) => [defaultPayInstructions(name)],
  },
  {
    key: "receiptNote",
    label: "Receipt note",
    hint: "Shown on the customer's invoice page once the bill is settled.",
    max: RECEIPT_NOTE_MAX,
    standards: () => [defaultReceiptNote()],
  },
  {
    key: "changeOrderAgreement",
    label: "Change-order agreement line",
    hint: "Shown above the signature when a customer approves extra work on a job.",
    max: CHANGE_ORDER_AGREEMENT_MAX,
    // Booked-variant first — it seeds the textarea; the signed-job variant is equally standard.
    standards: (name) => [
      defaultChangeOrderAgreement(name, false),
      defaultChangeOrderAgreement(name, true),
    ],
  },
];

/** What the row saves: trimmed text, or null when blank or identical to a standard sentence. */
const normalize = (text: string, standards: readonly string[]): string | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return standards.includes(trimmed) ? null : trimmed;
};

type Documents = Record<SlotKey, string | null>;

/** The sentence the document renders right now — override when set, else the seed standard. */
const effectiveFor = (slot: Slot, documents: Documents, brandName: string): string =>
  documents[slot.key] ?? slot.standards(brandName)[0] ?? "";

/** "Standard wording" until something is custom; then say how many lines are. */
const summaryFor = (documents: Documents): string => {
  const customCount = SLOTS.filter((s) => documents[s.key] !== null).length;
  if (customCount === 0) return "Standard wording";
  return `${customCount} custom line${customCount === 1 ? "" : "s"}`;
};

export function DocumentsCard() {
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const save = api.v1.settings.updateDocuments.useMutation();
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  const [openKey, setOpenKey] = useState<SlotKey | null>(null);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Gate on the real values having arrived — a textarea seeded from an in-flight query would
  // invite a Save that overwrites a real override with the standard sentence.
  if (!settings.isFetched || !settings.data) {
    return (
      <FoldCardShell summary="Loading…">
        <p className="muted" style={{ fontSize: "var(--type-base)", margin: 0 }}>
          Loading…
        </p>
      </FoldCardShell>
    );
  }

  const brandName = settings.data.brand.name;
  const documents = settings.data.documents;

  function toggle(slot: Slot) {
    setSaveError(null);
    resetSaved();
    if (openKey === slot.key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(slot.key);
    setDraft(effectiveFor(slot, documents, brandName));
  }

  function persist(slot: Slot, value: string | null) {
    setSaveError(null);
    save.mutate(
      { [slot.key]: value },
      {
        onSuccess: () => {
          // Both reads must refetch: the office payload (this card, the preview modal) AND the
          // anyRole wording read the field surfaces hydrate from.
          void utils.v1.settings.get.invalidate();
          void utils.v1.settings.documentWording.invalidate();
          flash();
        },
        onError: (err) => {
          setSaveError(userMessage(err, "Couldn't save the wording — try again."));
        },
      },
    );
  }

  return (
    <FoldCardShell summary={summaryFor(documents)}>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-3)" }}>
        The wording on customer documents. A line left as is keeps the standard wording.
      </p>

      {SLOTS.map((slot) => (
        <SlotRow
          key={slot.key}
          slot={slot}
          override={documents[slot.key]}
          brandName={brandName}
          open={openKey === slot.key}
          draft={draft}
          pending={save.isPending}
          saved={saved}
          error={saveError}
          onToggle={() => toggle(slot)}
          onDraft={(text) => {
            setDraft(text);
            setSaveError(null);
            resetSaved();
          }}
          onSave={() => persist(slot, normalize(draft, slot.standards(brandName)))}
          onReset={() => {
            setDraft(slot.standards(brandName)[0] ?? "");
            persist(slot, null);
          }}
        />
      ))}
    </FoldCardShell>
  );
}

interface SlotRowProps {
  readonly slot: Slot;
  readonly override: string | null;
  readonly brandName: string;
  readonly open: boolean;
  readonly draft: string;
  readonly pending: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  readonly onToggle: () => void;
  readonly onDraft: (text: string) => void;
  readonly onSave: () => void;
  readonly onReset: () => void;
}

/** One wording slot: a quiet disclosure row whose editor expands in-flow beneath it. */
function SlotRow({
  slot,
  override,
  brandName,
  open,
  draft,
  pending,
  saved,
  error,
  onToggle,
  onDraft,
  onSave,
  onReset,
}: SlotRowProps) {
  return (
    <DisclosureRow
      label={slot.label}
      // The collapsed value is the CURRENT state: the shop's own line when one stands,
      // otherwise "Standard" — except the footer, whose standard is no footer at all.
      value={override ?? (slot.standards(brandName).length > 0 ? "Standard" : "None")}
      open={open}
      onToggle={onToggle}
    >
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-2)" }}>
        {slot.hint}
      </p>
      <textarea
        className="field-compact"
        aria-label={slot.label}
        rows={3}
        maxLength={slot.max}
        style={{ width: "100%", resize: "vertical" }}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginTop: "var(--space-2)",
        }}
      >
        <Button onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {override !== null && (
          <button type="button" className="btn sm" disabled={pending} onClick={onReset}>
            Reset to standard
          </button>
        )}
        <SavedFlash saved={saved} />
      </div>
      {error && (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}
        >
          {error}
        </p>
      )}
    </DisclosureRow>
  );
}

/** One shell for the loading and loaded states, so the card never changes shape mid-fetch. */
function FoldCardShell({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <FoldCard title={TITLE} mark={<MarkDocuments />} summary={summary}>
      {children}
    </FoldCard>
  );
}
