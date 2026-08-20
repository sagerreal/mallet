"use client";

/**
 * Presentation tab — the designed pages that wrap this quote into a proposal, rendered
 * full-page like the mock: template pills, per-quote page chips, then the pages themselves
 * with quiet in-flow editing.
 *
 * Content is SHARED (editing a page writes through to the org template via settings);
 * activation is PER-QUOTE (the chips toggle this quote's copy only). A quote with no
 * presentation — or every page off — sends as the plain quote, which stays the default.
 */

import { useId, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Field } from "@/components/ui/input";
import type { ComposerPresentation, ComposerState } from "./composer-state";
import { patchPresentationPage, togglePresentationPage } from "./composer-state";
import type { PresentationPageKey } from "./presentation-state";

const PAGE_TITLE_MAX = 120;
const PAGE_BODY_MAX = 8_000;

export function PresentationTab({
  state,
  onUpdate,
  leadName,
  leadJob,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leadName: string | null;
  /** The customer's job description — the first choice for the quote title, same as the payload. */
  leadJob: string | null;
}) {
  const uid = useId();
  const templatesQuery = api.v1.settings.presentationTemplates.list.useQuery(undefined, {
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
          <div
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}
          >
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
                {page.key === "cover" ? "Cover — always on" : page.title || page.key}
              </button>
            ))}
          </div>
        )}
        {p && (
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
            Page toggles change THIS quote only. Page content is shared — editing it updates the
            template for every future quote. Sent quotes keep the pages they were sent with.
          </p>
        )}
      </div>

      {/* ---- the pages, rendered ---- */}
      {p && (
        <>
          {/* Cover — derived content: the work, the customer, the shop. */}
          <div
            className="card"
            style={{ background: "var(--accent)", color: "var(--pri-fg)", border: "none" }}
          >
            <div
              style={{
                fontSize: "var(--type-xs)",
                letterSpacing: ".14em",
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              Proposal{p.name ? ` · ${p.name}` : ""}
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-3xl)",
                fontWeight: 800,
                letterSpacing: "-.02em",
                lineHeight: 1.1,
                margin: "var(--space-3) 0",
                maxWidth: "18ch",
              }}
            >
              {quoteTitle}
            </div>
            <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>
              {leadName ? `Prepared for ${leadName}` : "Pick a customer on the Estimate tab"}
            </div>
          </div>

          {p.pages
            .filter((page) => page.key !== "cover" && page.key !== "thanks")
            .map((page) => (
              <PageCard
                key={page.key}
                page={page}
                canEdit={p.templateId !== null}
                editing={editKey === page.key}
                editTitle={editTitle}
                editBody={editBody}
                editError={editError}
                saving={updateMutation.isPending}
                uid={uid}
                onEdit={() => openEditor(p, page.key)}
                onTitle={setEditTitle}
                onBody={setEditBody}
                onSave={() => void saveEditor()}
                onCancel={() => setEditKey(null)}
              />
            ))}

          {/* The estimate's place in the flow — built on the other tab, embedded here. */}
          <div className="card" style={{ borderStyle: "dashed" }}>
            <p className="muted" style={{ margin: 0, fontSize: "var(--type-sm)" }}>
              Your estimate appears here — build it on the Estimate tab.
            </p>
          </div>

          {p.pages
            .filter((page) => page.key === "thanks")
            .map((page) => (
              <PageCard
                key={page.key}
                page={page}
                canEdit={p.templateId !== null}
                editing={editKey === page.key}
                editTitle={editTitle}
                editBody={editBody}
                editError={editError}
                saving={updateMutation.isPending}
                uid={uid}
                onEdit={() => openEditor(p, page.key)}
                onTitle={setEditTitle}
                onBody={setEditBody}
                onSave={() => void saveEditor()}
                onCancel={() => setEditKey(null)}
              />
            ))}

          {p.templateId === null && (
            <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-3)" }}>
              From a sent quote — these pages are the frozen copy it was sent with. Pick a template
              above to edit shared pages.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PageCard({
  page,
  canEdit,
  editing,
  editTitle,
  editBody,
  editError,
  saving,
  uid,
  onEdit,
  onTitle,
  onBody,
  onSave,
  onCancel,
}: {
  page: { key: PresentationPageKey; on: boolean; title: string; body: string };
  canEdit: boolean;
  editing: boolean;
  editTitle: string;
  editBody: string;
  editError: string | null;
  saving: boolean;
  uid: string;
  onEdit: () => void;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!page.on) return null;
  const editorId = `${uid}-edit-${page.key}`;
  return (
    <div className="card" style={{ opacity: page.body.trim() || editing ? 1 : 0.75 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
        <span
          style={{
            fontSize: "var(--type-xs)",
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            fontWeight: 700,
          }}
        >
          {page.title || page.key}
        </span>
        {canEdit && (
          <button
            type="button"
            className="linklike"
            style={{ marginLeft: "auto", fontSize: "var(--type-sm)" }}
            aria-expanded={editing}
            aria-controls={editorId}
            onClick={editing ? onCancel : onEdit}
          >
            {editing ? "Close" : "Edit ›"}
          </button>
        )}
      </div>

      {!editing && page.body.trim() && (
        <p style={{ whiteSpace: "pre-wrap", margin: "var(--space-3) 0 0", maxWidth: "62ch" }}>{page.body}</p>
      )}
      {!editing && !page.body.trim() && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0 0" }}>
          Empty — hidden from the customer until it says something.
        </p>
      )}

      {editing && (
        <div id={editorId} style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Field label="Page title">
            <input
              type="text"
              value={editTitle}
              maxLength={PAGE_TITLE_MAX}
              onChange={(e) => onTitle(e.target.value)}
            />
          </Field>
          <Field label="Page body" hint="What the customer reads on this page.">
            <textarea
              value={editBody}
              maxLength={PAGE_BODY_MAX}
              rows={Math.min(12, Math.max(4, editBody.split("\n").length + 1))}
              onChange={(e) => onBody(e.target.value)}
            />
          </Field>
          {editError && (
            <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: 0 }}>{editError}</p>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className="btn primary sm" disabled={saving} onClick={onSave}>
              Save to template
            </button>
            <button type="button" className="btn ghost sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
