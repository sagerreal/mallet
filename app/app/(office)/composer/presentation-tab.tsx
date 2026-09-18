"use client";

/**
 * Presentation tab — WYSIWYG. The tab renders the proposal document the customer will open
 * (composer-v4 mock, 1:1): a slim control bar (template pills + per-quote page chips), then the
 * document itself — dark cover page, company bar, the shop's pages, the estimate in its place in
 * the flow, and the thank-you — each with quiet in-place editing.
 *
 * Content is SHARED (editing a page writes through to the org template via settings);
 * activation is PER-QUOTE (the chips toggle this quote's copy only). A quote with no
 * presentation — or every page off — sends as the plain quote, which stays the default.
 *
 * The estimate section renders from the SAME state and the SAME totals math as the customer
 * page (computeQuoteTotals), so what the office sees here is what the customer gets.
 */

import { useId, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Field } from "@/components/ui/input";
import type { ComposerLine, ComposerPresentation, ComposerState } from "./composer-state";
import { gbbTierTotal, patchPresentationPage, realLines, togglePresentationPage } from "./composer-state";
import { defaultPresentation, patchPresentationDesign, setPagePhotos, setPresentationMode } from "./presentation-state";
import type { ComposerPhoto, ComposerPresentationPage } from "./presentation-state";
import { PhotoPage } from "./photo-page";
import { DocToolbar } from "./doc-toolbar";
import { coverSheetPages, estimateSheetPhotos, hasCoverSheet, sheetStyleFor, warrantySheetPage } from "./doc-design";
import type { PresentationPageKey } from "./presentation-state";
import { computeQuoteTotals } from "@/app/(public)/q/[token]/quote-totals";

const PAGE_TITLE_MAX = 120;
const PAGE_BODY_MAX = 8_000;

/** $17,982 for whole dollars, $4,495.50 otherwise — the document's money voice. */
function docMoney(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${Math.abs(dollars).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const kickerStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--type-xs)",
  letterSpacing: ".16em",
  textTransform: "uppercase",
};

export function PresentationTab({
  state,
  onUpdate,
  leadName,
  leadJob,
  onGoToEstimate,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leadName: string | null;
  /** The customer's job description — the first choice for the quote title, same as the payload. */
  leadJob: string | null;
  /** Switch to the Estimate tab — the embedded estimate section is edited there. */
  onGoToEstimate: () => void;
}) {
  const uid = useId();
  const templatesQuery = api.v1.settings.presentationTemplates.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  // The company bar on the document — the same identity block every customer document prints.
  const identityQuery = api.v1.settings.businessIdentity.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const createMutation = api.v1.settings.presentationTemplates.create.useMutation();
  const updateMutation = api.v1.settings.presentationTemplates.update.useMutation();
  const utils = api.useUtils();

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<PresentationPageKey | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const templates = templatesQuery.data ?? [];
  // Every quote is a document (the mock's model). A legacy draft saved with none gets the
  // default — the first edit or save writes it onto the quote.
  const p = state.presentation ?? defaultPresentation();

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // A per-quote COPY: chips below edit this quote only, never the template.
    onUpdate({
      presentation: { templateId: t.id, name: t.name, pages: t.pages.map((page) => ({ ...page })) },
    });
    setEditKey(null);
  }

  async function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    setCreateError(null);
    try {
      const t = await createMutation.mutateAsync({ name });
      await utils.v1.settings.presentationTemplates.list.invalidate();
      onUpdate({
        presentation: { templateId: t.id, name: t.name, pages: t.pages.map((page) => ({ ...page })) },
      });
      setNewOpen(false);
      setNewName("");
    } catch {
      setCreateError("Template not created — check your connection and try again.");
    }
  }

  function openEditor(presentation: ComposerPresentation, key: PresentationPageKey) {
    const page = presentation.pages.find((x) => x.key === key);
    if (!page) return;
    setEditKey(key);
    setEditTitle(page.title);
    setEditBody(page.body);
    setEditError(null);
  }

  async function saveEditor() {
    if (!editKey) return;
    // Unlinked — the default document, or the frozen copy a revise restores: the edit is this
    // quote's alone. Nothing is shared, so nothing writes to the server.
    if (!p.templateId) {
      onUpdate({ presentation: patchPresentationPage(p, editKey, { title: editTitle, body: editBody }) });
      setEditKey(null);
      return;
    }
    const t = templates.find((x) => x.id === p.templateId);
    if (!t) {
      // The template list is empty or no longer holds this id — archived in another session, or
      // the query is refetching after a cache eviction. Saying so beats a Save button that
      // silently does nothing while the office believes their copy landed.
      setEditError("That template is no longer in your list — reload the page and try again.");
      return;
    }
    setEditError(null);
    // Write through to the TEMPLATE (shared content), then mirror into this quote's copy.
    const pages = t.pages.map((page) =>
      page.key === editKey ? { ...page, title: editTitle, body: editBody } : page,
    );
    try {
      await updateMutation.mutateAsync({ id: p.templateId, pages });
      await utils.v1.settings.presentationTemplates.list.invalidate();
      onUpdate({
        presentation: patchPresentationPage(p, editKey, { title: editTitle, body: editBody }),
      });
      setEditKey(null);
    } catch {
      setEditError("Page not saved — check your connection and try again.");
    }
  }

  // EXACTLY the title buildDraftPayload freezes onto the quote — the masthead title when one
  // was typed, else the customer's job description, else the first line. A preview showing any
  // other chain is lying about the document that gets sent.
  const quoteTitle =
    state.title.trim() || leadJob?.trim() || state.lines.find((l) => l.d.trim())?.d?.trim() || "Quote";

  const identity = identityQuery.data ?? null;
  const orgName = identity?.name ?? "";
  const orgInitials = orgName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const photosPage = estimateSheetPhotos(p);
  const warrantyPage = warrantySheetPage(p);


  const editorProps = {
    editTitle,
    editBody,
    editError,
    saveLabel: p.templateId ? "Save to template" : "Save",
    saving: updateMutation.isPending,
    onTitle: setEditTitle,
    onBody: setEditBody,
    onSave: () => void saveEditor(),
    onCancel: () => setEditKey(null),
  };

  // Built once, placed by mode: the cover SHEET leads a Full document; Simple keeps the cover
  // head inline on its one page.
  const coverHead = (
    <CoverHead
      page={p.pages.find((page) => page.key === "cover") ?? null}
      quoteTitle={quoteTitle}
      leadName={leadName}
      orgName={orgName}
      contact={[identity?.address, identity?.phone].filter(Boolean).join(" · ")}
      validDays={state.validDays}
      editing={editKey === "cover"}
      onEdit={() => openEditor(p, "cover")}
      onGoToEstimate={onGoToEstimate}
      uid={uid}
      {...editorProps}
    />
  );

  return (
    <div>
      {/* ---- the template row — which shared page-set this document draws from ---- */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>Template</span>
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              className={p.templateId === t.id ? "chip on" : "chip"}
              aria-pressed={p.templateId === t.id}
              onClick={() =>
                p.templateId === t.id
                  ? onUpdate({ presentation: defaultPresentation() })
                  : pickTemplate(t.id)
              }
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-expanded={newOpen}
            aria-controls={`${uid}-newtpl`}
            onClick={() => setNewOpen((v) => !v)}
          >
            ＋ New
          </button>
        </div>
        {newOpen && (
          <div
            id={`${uid}-newtpl`}
            style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}
          >
            <Field label="Template name" style={{ flex: "1 1 240px" }}>
              <input
                type="text"
                value={newName}
                maxLength={80}
                placeholder="Interior, Exterior repair…"
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="btn primary sm"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => void createTemplate()}
            >
              Create
            </button>
          </div>
        )}
        {createError && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{createError}</p>
        )}
        {templatesQuery.isError && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            Your templates didn&apos;t load — reload the page to try again.
          </p>
        )}
      </div>

      {/* ---- the document toolbar ---- */}
      <div style={{ maxWidth: 760, margin: "var(--space-4) auto 0" }}>
        <DocToolbar
          presentation={p}
          onMode={(mode) => onUpdate({ presentation: setPresentationMode(p, mode) })}
          onDesign={(patch) => onUpdate({ presentation: patchPresentationDesign(p, patch) })}
          onTogglePage={(key) => onUpdate({ presentation: togglePresentationPage(p, key) })}
        />
      </div>

      {/* ---- customer chrome: one slim bar — who it's from, and the way to accept ---- */}
      <div
        style={{
          maxWidth: 760,
          margin: "var(--space-3) auto 0",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 800 }}>
          {orgInitials && (
            <span
              aria-hidden
              style={{
                width: "var(--space-6)",
                height: "var(--space-6)",
                borderRadius: "var(--radius-xs)",
                background: "var(--accent)",
                color: "var(--pri-fg)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--type-xs)",
              }}
            >
              {orgInitials}
            </span>
          )}
          {orgName}
        </span>
        <button
          type="button"
          className="btn primary sm"
          style={{ marginLeft: "auto" }}
          title="Scrolls to the acceptance block — the button the customer gets"
          onClick={() => {
            // The accept preview exists once the estimate has lines; before that, land on the
            // estimate section itself — the button must never be a silent no-op.
            const target =
              document.querySelector("[data-accept-anchor]") ??
              document.querySelector('[aria-label="Your estimate"]');
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          Accept estimate
        </button>
      </div>

      {/* ---- the document, as paper ----
          Simple is ONE sheet: cover head, photos, the estimate, the warranty, the terms and
          the thank-you. Full puts a cover letter and the shop's story on a sheet in front. */}
      <div className="sheets" style={sheetStyleFor(p)}>
        {hasCoverSheet(p) && (
          <article className="docsheet" aria-label="Cover page">
            {coverHead}
            {coverSheetPages(p).map((page) => (
              <PageSection
                key={page.key}
                page={page}
                editing={editKey === page.key}
                onEdit={() => openEditor(p, page.key)}
                uid={uid}
                onPhotos={(next) => onUpdate({ presentation: setPagePhotos(p, page.key, next) })}
                {...editorProps}
              />
            ))}
            <footer className="docsheet-foot">
              <span>{orgName}</span>
              <span>Page 1 of 2</span>
            </footer>
          </article>
        )}

        <article className="docsheet" aria-label="The estimate">
          {!hasCoverSheet(p) && coverHead}
          {!hasCoverSheet(p) && photosPage && (
            <PageSection
              page={photosPage}
              editing={editKey === photosPage.key}
              onEdit={() => openEditor(p, photosPage.key)}
              uid={uid}
              onPhotos={(next) => onUpdate({ presentation: setPagePhotos(p, photosPage.key, next) })}
              {...editorProps}
            />
          )}
          <EstimateSection state={state} onGoToEstimate={onGoToEstimate} />
          {warrantyPage && (
            <PageSection
              page={warrantyPage}
              editing={editKey === warrantyPage.key}
              onEdit={() => openEditor(p, warrantyPage.key)}
              uid={uid}
              {...editorProps}
            />
          )}
          <TermsSection text={state.terms?.text ?? null} />
          {p.pages
            .filter((page) => page.on && page.key === "thanks")
            .map((page) => (
              <ThanksSection
                key={page.key}
                page={page}
                editing={editKey === page.key}
                onEdit={() => openEditor(p, page.key)}
                uid={uid}
                {...editorProps}
              />
            ))}
          <footer className="docsheet-foot">
            <span>{orgName}</span>
            <span>{hasCoverSheet(p) ? "Page 2 of 2" : "Page 1 of 1"}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}

// ---- shared section pieces -----------------------------------------------------

interface SectionEditorProps {
  editTitle: string;
  editBody: string;
  editError: string | null;
  /** "Save to template" when the copy is linked (shared content); plain "Save" when it is this quote's alone. */
  saveLabel: string;
  saving: boolean;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** The quiet in-place edit affordance every editable section carries, top-right. */
function EditChip({
  label,
  editing,
  controls,
  onClick,
}: {
  label: string;
  editing: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={editing}
      aria-controls={controls}
      onClick={onClick}
      style={{
        ...kickerStyle,
        letterSpacing: ".09em",
        position: "absolute",
        top: "var(--space-3)",
        right: "var(--space-3)",
        color: "var(--ink-2)",
        border: "1px solid var(--line)",
        background: "var(--card)",
        borderRadius: "var(--radius-pill)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
      }}
    >
      {editing ? "CLOSE" : label}
    </button>
  );
}

/** Title/body editor rendered IN the section, on a card surface so it reads on dark pages too. */
function SectionEditor({
  id,
  titleLabel,
  titleHint,
  editor,
}: {
  id: string;
  titleLabel: string;
  titleHint?: string;
  editor: SectionEditorProps;
}) {
  return (
    <div
      id={id}
      style={{
        marginTop: "var(--space-4)",
        background: "var(--card)",
        color: "var(--ink)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        textAlign: "left",
      }}
    >
      <Field label={titleLabel} hint={titleHint}>
        <input
          type="text"
          value={editor.editTitle}
          maxLength={PAGE_TITLE_MAX}
          onChange={(e) => editor.onTitle(e.target.value)}
        />
      </Field>
      <Field label="Page body" hint="What the customer reads on this page.">
        <textarea
          value={editor.editBody}
          maxLength={PAGE_BODY_MAX}
          rows={Math.min(12, Math.max(4, editor.editBody.split("\n").length + 1))}
          onChange={(e) => editor.onBody(e.target.value)}
        />
      </Field>
      {editor.editError && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: 0 }}>{editor.editError}</p>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button type="button" className="btn primary sm" disabled={editor.saving} onClick={editor.onSave}>
          {editor.saveLabel}
        </button>
        <button type="button" className="btn ghost sm" onClick={editor.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// The composer's own page shape — the one the sections render. Aliased rather than redeclared
// so a field added to the model (photos, and whatever comes next) reaches these sections too.
type PresentationPage = ComposerPresentationPage;

// ---- cover ---------------------------------------------------------------------

/**
 * The mock's cover head — kicker, the document's title, the "what this covers" line, and the
 * three meta blocks (Prepared for / From / Estimate). Light, on the sheet, exactly what the
 * customer's ProposalCover prints; teaching copy stands in for a customer not yet picked.
 */
function CoverHead({
  page,
  quoteTitle,
  leadName,
  orgName,
  contact,
  validDays,
  editing,
  onEdit,
  onGoToEstimate,
  uid,
  ...editor
}: {
  page: PresentationPage | null;
  quoteTitle: string;
  leadName: string | null;
  orgName: string;
  contact: string;
  validDays: number;
  editing: boolean;
  onEdit: () => void;
  onGoToEstimate: () => void;
  uid: string;
} & SectionEditorProps) {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const editorId = `${uid}-edit-cover`;
  return (
    <header className="doccover" aria-label="Cover">
      <EditChip label="EDIT COVER ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      <div className="kick">Proposal{orgName ? ` · ${orgName}` : ""}</div>
      <h2>{quoteTitle}</h2>
      {page?.title.trim() ? <p className="sub">{page.title}</p> : null}
      <div className="docmeta">
        <div className="blk">
          <div className="k">Prepared for</div>
          <div className="v">
            {leadName ? (
              <>
                <b>{leadName}</b>
                <div>{today}</div>
              </>
            ) : (
              <button
                type="button"
                onClick={onGoToEstimate}
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--ink-2)",
                }}
              >
                Add a customer on the Estimate tab —<br />their name leads the cover
              </button>
            )}
          </div>
        </div>
        <div className="blk">
          <div className="k">From</div>
          <div className="v">
            <b>{orgName || "Your company"}</b>
            {contact ? <div>{contact}</div> : null}
          </div>
        </div>
        <div className="blk">
          <div className="k">Estimate</div>
          <div className="v">
            <b>Draft</b>
            <div>Valid {validDays} days</div>
          </div>
        </div>
      </div>
      {page?.body.trim() ? (
        <p className="docbody" style={{ whiteSpace: "pre-wrap" }}>
          {page.body}
        </p>
      ) : null}
      {editing && (
        <SectionEditor
          id={editorId}
          titleLabel="What this covers"
          titleHint="The line under the title — e.g. Cedar privacy fence, supply & install."
          editor={editor}
        />
      )}
    </header>
  );
}

// ---- terms ---------------------------------------------------------------------

/** Fixed — a proposal with no terms is not a proposal. The text is the quote's own snapshot. */
function TermsSection({ text }: { text: string | null }) {
  return (
    <section
      aria-label="Terms and conditions"
      style={{ position: "relative", padding: "var(--space-8)", borderTop: "1px solid var(--line)" }}
    >
      <div style={{ ...kickerStyle, color: "var(--ink-3)", marginBottom: "var(--space-3)" }}>
        Terms &amp; conditions
      </div>
      {text?.trim() ? (
        <p
          style={{
            fontSize: "var(--type-sm)",
            color: "var(--ink-2)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {text}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
          No terms yet — pick them in the Terms panel on the Estimate tab.
        </p>
      )}
    </section>
  );
}

// ---- shop pages (about us / reviews) -------------------------------------------

function PageSection({
  page,
  editing,
  onEdit,
  uid,
  onPhotos,
  ...editor
}: {
  page: PresentationPage;
  editing: boolean;
  onEdit: () => void;
  uid: string;
  /** Only the photos page uses this. Absent elsewhere, so nothing else can grow images. */
  onPhotos?: (next: ComposerPhoto[]) => void;
} & SectionEditorProps) {
  const editorId = `${uid}-edit-${page.key}`;
  return (
    <section
      aria-label={page.title || page.key}
      style={{
        position: "relative",
        padding: "var(--space-8)",
        borderTop: "1px solid var(--line)",
        // No opacity for an empty page. Dimming multiplies against every colour inside, including
        // the muted ones already sitting at the contrast floor — a freshly-added page failed
        // color-contrast three ways. The page already SAYS it is empty a line below; saying it
        // again in a way that costs legibility is not emphasis, it is a defect.
      }}
    >
      <EditChip label="EDIT ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      <div style={{ ...kickerStyle, color: "var(--ink-3)", marginBottom: "var(--space-3)" }}>
        {page.title.trim() || page.key}
      </div>
      {page.body.trim() ? (
        <p
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "var(--type-md)",
            lineHeight: 1.6,
            color: "var(--ink-2)",
            margin: 0,
            maxWidth: "64ch",
          }}
        >
          {page.body}
        </p>
      ) : (
        // A page with PICTURES is not empty. The photos page's whole content is its photos, so
        // testing the prose alone told the office a page full of before-and-afters was blank —
        // and its own add-photo frame already says what to do, so the generic line would say
        // it twice.
        !editing &&
        page.key !== "photos" &&
        (page.photos?.length ?? 0) === 0 && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
            Empty — hidden from the customer until it says something.
          </p>
        )
      )}
      {/* The photos page carries images, not prose — its body is the caption above them. */}
      {page.key === "photos" && onPhotos && (
        <div style={{ marginTop: page.body.trim() ? "var(--space-3)" : 0 }}>
          <PhotoPage photos={page.photos ?? []} onChange={onPhotos} readOnly={false} />
        </div>
      )}
      {editing && <SectionEditor id={editorId} titleLabel="Page title" editor={editor} />}
    </section>
  );
}

// ---- the estimate, embedded ----------------------------------------------------

function EstimateSection({
  state,
  onGoToEstimate,
}: {
  state: ComposerState;
  onGoToEstimate: () => void;
}) {
  const gbb = state.format === "gbb" && state.gbb ? state.gbb : null;
  const lines = gbb ? [] : realLines(state.lines);
  const workLines = lines.filter((l) => !l.opt);
  const optLines = lines.filter((l) => l.opt);
  const showLineAmounts = state.priceDisplay !== "total";

  // The customer's opening numbers — fixed lines only, add-ons off, through the SAME cents
  // pipeline the public page and the server run (subtotal → discount → tax → total → deposit).
  const toCents = (l: ComposerLine) => Math.round(l.q * Math.round(l.r * 100));
  const totals = computeQuoteTotals({
    fixedSubtotalCents: workLines.reduce((s, l) => s + toCents(l), 0),
    fixedTaxableCents: workLines.reduce((s, l) => s + (l.notax ? 0 : toCents(l)), 0),
    selectedOptionalLines: [],
    discBps: Math.round((state.pricing.disc ?? 0) * 100),
    taxBps: Math.round((state.pricing.tax ?? 0) * 100),
    depBps: Math.round((state.pricing.dep ?? 0) * 100),
  });

  return (
    <section
      aria-label="Your estimate"
      style={{ position: "relative", padding: "var(--space-8)", borderTop: "1px solid var(--line)" }}
    >
      <button
        type="button"
        onClick={onGoToEstimate}
        style={{
          ...kickerStyle,
          letterSpacing: ".09em",
          position: "absolute",
          top: "var(--space-3)",
          right: "var(--space-3)",
          color: "var(--ink-2)",
          border: "1px solid var(--line)",
          background: "var(--card)",
          borderRadius: "var(--radius-pill)",
          padding: "var(--space-1) var(--space-3)",
          cursor: "pointer",
        }}
      >
        EDIT ON THE ESTIMATE TAB ›
      </button>
      <div style={{ ...kickerStyle, color: "var(--ink-3)", marginBottom: "var(--space-3)" }}>Your estimate</div>

      {gbb ? (
        <>
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-3)" }}>
            Good, Better &amp; Best — the customer picks one of these options.
          </p>
          {gbb.opts.map((tier) => (
            <div
              key={tier.k}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "var(--space-3)",
                padding: "var(--space-2) 0",
                borderTop: "1px solid var(--line-2)",
                fontSize: "var(--type-base)",
              }}
            >
              <b>{tier.name}</b>
              {tier.k === gbb.rec && (
                <span style={{ ...kickerStyle, fontSize: "var(--type-xs)", color: "var(--green-700)" }}>
                  Recommended
                </span>
              )}
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                {tier.title}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                {docMoney(Math.round(gbbTierTotal(tier) * 100))}
              </span>
            </div>
          ))}
        </>
      ) : workLines.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
          No line items yet — build the estimate on the Estimate tab.
        </p>
      ) : (
        <>
          <div style={{ ...kickerStyle, fontSize: "var(--type-xs)", color: "var(--ink-3)", margin: "var(--space-4) 0 var(--space-1)" }}>
            The work
          </div>
          {workLines.map((line, i) => (
            <div key={i} style={{ padding: "var(--space-2) 0", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", fontSize: "var(--type-base)" }}>
                <span>{line.d}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--type-sm)",
                    color: showLineAmounts ? "var(--ink)" : "var(--ink-3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {showLineAmounts ? docMoney(toCents(line)) : line.q !== 1 ? `× ${line.q}` : ""}
                </span>
              </div>
              {line.scope?.trim() && (
                <p
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: "var(--type-sm)",
                    lineHeight: 1.55,
                    color: "var(--ink-2)",
                    margin: "var(--space-1) 0 0",
                    maxWidth: "64ch",
                  }}
                >
                  {line.scope}
                </p>
              )}
            </div>
          ))}

          {optLines.length > 0 && (
            <>
              <div style={{ ...kickerStyle, fontSize: "var(--type-xs)", color: "var(--ink-3)", margin: "var(--space-4) 0 var(--space-1)" }}>
                Upgrade options — the customer can add these
              </div>
              {optLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--paper)",
                    padding: "var(--space-3) var(--space-4)",
                    marginTop: "var(--space-2)",
                    fontSize: "var(--type-base)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{line.d}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--green-700)" }}>
                    +{docMoney(toCents(line))}
                  </span>
                </div>
              ))}
            </>
          )}

          <div
            style={{
              background: "var(--paper)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4) var(--space-5)",
              marginTop: "var(--space-5)",
              fontSize: "var(--type-base)",
            }}
          >
            <TotalRow label="Subtotal" cents={totals.subtotalCents} muted />
            {totals.discountCents > 0 && (
              <TotalRow label={`Discount (${state.pricing.disc}%)`} cents={-totals.discountCents} muted />
            )}
            {totals.taxCents > 0 && <TotalRow label={`Tax (${state.pricing.tax}%)`} cents={totals.taxCents} muted />}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                fontSize: "var(--type-md)",
                borderTop: "1px solid var(--line)",
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
              }}
            >
              <span>Total</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{docMoney(totals.totalCents)}</span>
            </div>
            {totals.depositCents > 0 && (
              <div style={{ fontSize: "var(--type-xs)", color: "var(--ink-3)", textAlign: "right", marginTop: "var(--space-1)" }}>
                {state.pricing.dep}% deposit due on signing — {docMoney(totals.depositCents)}
              </div>
            )}
          </div>

          {/* What the customer's accept button will say — a preview, not a control. The
              company bar's "Accept estimate" scrolls here, the way the customer's own does. */}
          <div
            aria-hidden
            data-accept-anchor
            style={{
              marginTop: "var(--space-4)",
              background: "var(--accent)",
              color: "var(--pri-fg)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              textAlign: "center",
              fontWeight: 800,
              fontSize: "var(--type-md)",
            }}
          >
            Accept &amp; sign — {docMoney(totals.totalCents)}
          </div>
        </>
      )}
    </section>
  );
}

function TotalRow({ label, cents, muted }: { label: string; cents: number; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "var(--space-1) 0",
        color: muted ? "var(--ink-2)" : "var(--ink)",
        fontSize: "var(--type-sm)",
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", color: cents < 0 ? "var(--green-700)" : undefined }}>
        {cents < 0 ? `−${docMoney(-cents)}` : docMoney(cents)}
      </span>
    </div>
  );
}

// ---- thank you -----------------------------------------------------------------

function ThanksSection({
  page,
  editing,
  onEdit,
  uid,
  ...editor
}: {
  page: PresentationPage;
  editing: boolean;
  onEdit: () => void;
  uid: string;
} & SectionEditorProps) {
  const editorId = `${uid}-edit-thanks`;
  return (
    <section
      aria-label={page.title || "Thank you"}
      style={{
        position: "relative",
        background: "var(--accent)",
        color: "var(--pri-fg)",
        textAlign: "center",
        padding: "var(--space-10) var(--space-8)",
      }}
    >
      <EditChip label="EDIT ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--type-2xl)",
          fontWeight: 800,
          margin: "0 0 var(--space-3)",
        }}
      >
        {page.title.trim() || "Thank you"}
      </h3>
      {page.body.trim() ? (
        <p
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "var(--type-base)",
            lineHeight: 1.6,
            opacity: 0.8,
            margin: "0 auto",
            maxWidth: "52ch",
          }}
        >
          {page.body}
        </p>
      ) : (
        !editing && (
          <p style={{ fontSize: "var(--type-sm)", opacity: 0.7, margin: 0 }}>
            Empty — hidden from the customer until it says something.
          </p>
        )
      )}
      {editing && <SectionEditor id={editorId} titleLabel="Page title" editor={editor} />}
    </section>
  );
}
