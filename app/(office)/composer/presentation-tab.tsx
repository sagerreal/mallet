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
  const p = state.presentation;

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
    if (!p || !p.templateId || !editKey) return;
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

  // EXACTLY the title buildDraftPayload freezes onto the quote (page.tsx: lead.job || first
  // line || "Quote") — the preview lied when it showed state.desc, which is the AI prompt box
  // and never reaches the customer.
  const quoteTitle = leadJob?.trim() || state.lines.find((l) => l.d.trim())?.d?.trim() || "Quote";

  const editorProps = {
    editTitle,
    editBody,
    editError,
    saving: updateMutation.isPending,
    onTitle: setEditTitle,
    onBody: setEditBody,
    onSave: () => void saveEditor(),
    onCancel: () => setEditKey(null),
  };

  return (
    <div>
      {/* ---- controls: template pills + per-quote page chips ---- */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>Template</span>
          <button
            type="button"
            className={p === null ? "chip on" : "chip"}
            aria-pressed={p === null}
            onClick={() => onUpdate({ presentation: null })}
          >
            No presentation
          </button>
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              className={p?.templateId === t.id ? "chip on" : "chip"}
              aria-pressed={p?.templateId === t.id}
              onClick={() => pickTemplate(t.id)}
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
          {p && (
            <>
              <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
              <span style={{ fontWeight: 700 }}>Pages</span>
              {p.pages.map((page) => (
                <button
                  type="button"
                  key={page.key}
                  className={page.on ? "chip on" : "chip"}
                  aria-pressed={page.on}
                  title={
                    page.key === "cover"
                      ? "The cover always leads an active presentation"
                      : page.on
                        ? "On — the customer sees this page"
                        : "Off — hidden from this quote"
                  }
                  disabled={page.key === "cover"}
                  onClick={() => onUpdate({ presentation: togglePresentationPage(p, page.key) })}
                >
                  {page.key === "cover" ? "Cover" : page.title || page.key}
                </button>
              ))}
            </>
          )}
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
        {templatesQuery.isPending && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            Loading your templates…
          </p>
        )}
        {templatesQuery.isError && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            Your templates didn&apos;t load — reload the page to try again.
          </p>
        )}
        {templates.length === 0 && !templatesQuery.isPending && !templatesQuery.isError && !newOpen && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            A presentation wraps this quote in your own pages — a cover, who you are, your reviews, a
            thank-you — before the customer reaches the price. Create your first template to start;
            without one the customer gets the plain quote.
          </p>
        )}
        {p && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            This is what the customer opens — off pages don&apos;t render. Page toggles change THIS
            quote only; page content is shared, so editing it updates the template for every future
            quote. Sent quotes keep the pages they were sent with.
          </p>
        )}
      </div>

      {/* ---- the document ---- */}
      {p && (
        <div
          style={{
            maxWidth: 860,
            margin: "var(--space-5) auto 0",
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          <CoverSection
            page={p.pages.find((page) => page.key === "cover") ?? null}
            quoteTitle={quoteTitle}
            leadName={leadName}
            canEdit={p.templateId !== null}
            editing={editKey === "cover"}
            onEdit={() => openEditor(p, "cover")}
            uid={uid}
            {...editorProps}
          />
          <CompanyBar identity={identityQuery.data ?? null} validDays={state.validDays} />
          {p.pages
            .filter((page) => page.on && page.key !== "cover" && page.key !== "thanks")
            .map((page) => (
              <PageSection
                key={page.key}
                page={page}
                canEdit={p.templateId !== null}
                editing={editKey === page.key}
                onEdit={() => openEditor(p, page.key)}
                uid={uid}
                {...editorProps}
              />
            ))}
          <EstimateSection state={state} quoteTitle={quoteTitle} onGoToEstimate={onGoToEstimate} />
          {p.pages
            .filter((page) => page.on && page.key === "thanks")
            .map((page) => (
              <ThanksSection
                key={page.key}
                page={page}
                canEdit={p.templateId !== null}
                editing={editKey === page.key}
                onEdit={() => openEditor(p, page.key)}
                uid={uid}
                {...editorProps}
              />
            ))}
        </div>
      )}

      {p && p.templateId === null && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-3)", textAlign: "center" }}>
          From a sent quote — these pages are the frozen copy it was sent with. Pick a template
          above to edit shared pages.
        </p>
      )}
    </div>
  );
}

// ---- shared section pieces -----------------------------------------------------

interface SectionEditorProps {
  editTitle: string;
  editBody: string;
  editError: string | null;
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
          Save to template
        </button>
        <button type="button" className="btn ghost sm" onClick={editor.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type PresentationPage = { key: PresentationPageKey; on: boolean; title: string; body: string };

// ---- cover ---------------------------------------------------------------------

function CoverSection({
  page,
  quoteTitle,
  leadName,
  canEdit,
  editing,
  onEdit,
  uid,
  ...editor
}: {
  page: PresentationPage | null;
  quoteTitle: string;
  leadName: string | null;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  uid: string;
} & SectionEditorProps) {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const editorId = `${uid}-edit-cover`;
  return (
    <section
      aria-label="Cover page"
      style={{
        position: "relative",
        background: "var(--accent)",
        color: "var(--pri-fg)",
        padding: "var(--space-10) var(--space-8) var(--space-8)",
      }}
    >
      {canEdit && (
        <EditChip label="EDIT COVER ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      )}
      <div style={{ ...kickerStyle, letterSpacing: ".2em", opacity: 0.75 }}>
        {page?.title.trim() || "Proposal"}
      </div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--type-4xl)",
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: "-.03em",
          margin: "var(--space-4) 0 var(--space-4)",
          maxWidth: "16ch",
        }}
      >
        {quoteTitle}
      </h2>
      <div style={{ fontSize: "var(--type-md)", opacity: 0.8 }}>
        {leadName ? (
          <>
            Prepared for <b style={{ opacity: 1 }}>{leadName}</b> &middot; {today}
          </>
        ) : (
          "Pick a customer on the Estimate tab"
        )}
      </div>
      {page?.body.trim() && (
        <p
          style={{
            fontSize: "var(--type-base)",
            lineHeight: 1.6,
            opacity: 0.8,
            margin: "var(--space-4) 0 0",
            maxWidth: "60ch",
            whiteSpace: "pre-wrap",
          }}
        >
          {page.body}
        </p>
      )}
      {editing && (
        <SectionEditor
          id={editorId}
          titleLabel="Cover heading"
          titleHint="The small line above the title — e.g. Proposal."
          editor={editor}
        />
      )}
    </section>
  );
}

// ---- company bar ---------------------------------------------------------------

function CompanyBar({
  identity,
  validDays,
}: {
  identity: { name: string; address: string | null; phone: string | null } | null;
  validDays: number;
}) {
  const name = identity?.name ?? "";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const contact = [identity?.address, identity?.phone].filter(Boolean).join(" · ");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        flexWrap: "wrap",
        background: "var(--accent-2)",
        color: "var(--pri-fg)",
        padding: "var(--space-3) var(--space-8)",
        fontSize: "var(--type-sm)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 800, fontSize: "var(--type-base)" }}>
        {initials && (
          <span
            aria-hidden
            style={{
              width: "var(--space-6)",
              height: "var(--space-6)",
              borderRadius: "var(--radius-xs)",
              background: "var(--pri-fg)",
              color: "var(--accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--type-xs)",
            }}
          >
            {initials}
          </span>
        )}
        {name}
      </span>
      {contact && <span style={{ opacity: 0.75 }}>{contact}</span>}
      <span style={{ ...kickerStyle, marginLeft: "auto", opacity: 0.75 }}>Valid {validDays} days</span>
    </div>
  );
}

// ---- shop pages (about us / reviews) -------------------------------------------

function PageSection({
  page,
  canEdit,
  editing,
  onEdit,
  uid,
  ...editor
}: {
  page: PresentationPage;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  uid: string;
} & SectionEditorProps) {
  const editorId = `${uid}-edit-${page.key}`;
  return (
    <section
      aria-label={page.title || page.key}
      style={{
        position: "relative",
        padding: "var(--space-8)",
        borderTop: "1px solid var(--line)",
        opacity: page.body.trim() || editing ? 1 : 0.75,
      }}
    >
      {canEdit && (
        <EditChip label="EDIT ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      )}
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
        !editing && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
            Empty — hidden from the customer until it says something.
          </p>
        )
      )}
      {editing && <SectionEditor id={editorId} titleLabel="Page title" editor={editor} />}
    </section>
  );
}

// ---- the estimate, embedded ----------------------------------------------------

function EstimateSection({
  state,
  quoteTitle,
  onGoToEstimate,
}: {
  state: ComposerState;
  quoteTitle: string;
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
        FROM THE ESTIMATE TAB — EDIT THERE ›
      </button>
      <div style={{ ...kickerStyle, color: "var(--ink-3)", marginBottom: "var(--space-3)" }}>Your estimate</div>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--type-xl)",
          fontWeight: 800,
          letterSpacing: "-.02em",
          margin: "0 0 var(--space-3)",
        }}
      >
        {quoteTitle}
      </h3>

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
          Your estimate appears here — build it on the Estimate tab.
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

          {/* What the customer's accept button will say — a preview, not a control. */}
          <div
            aria-hidden
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
  canEdit,
  editing,
  onEdit,
  uid,
  ...editor
}: {
  page: PresentationPage;
  canEdit: boolean;
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
      {canEdit && (
        <EditChip label="EDIT ›" editing={editing} controls={editorId} onClick={editing ? editor.onCancel : onEdit} />
      )}
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
