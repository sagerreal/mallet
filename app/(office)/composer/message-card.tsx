"use client";

/**
 * Terms section — the terms attached to the quote. Boxed card shell; collapsible in-flow.
 *
 * This card used to also hold the intro and the price-valid window; both moved to where they
 * are read — the intro into the Send card (it is the note that rides with the link) and
 * validity into the masthead. Terms come from the real job_terms library (settings store,
 * hydrated by SettingsHydrator); selecting one SNAPSHOTS its text into the draft payload
 * (terms_snapshot) — later term edits never rewrite a sent quote. "None" attaches nothing.
 */

import { useAppStore } from "@/lib/store/app-store";
import type { ComposerState } from "./composer-state";
import { Field } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";

export function MessageCard({
  state,
  onUpdate,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
}) {
  // Real job_terms from settings (t = title, body = the text that snapshots).
  const terms = useAppStore((s) => s.terms);
  const selectedTerm = state.terms
    ? terms.find((t) => t.id === state.terms!.id) ?? null
    : null;

  function selectTerms(id: string) {
    if (id === "") {
      onUpdate({ terms: null });
      return;
    }
    const term = terms.find((t) => t.id === id);
    // Freeze the TEXT at selection — snapshot semantics.
    onUpdate({ terms: term ? { id: term.id, text: term.body } : null });
  }

  return (
    <div className="card">
      <div className={`reveal${state.msgOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ msgOpen: !state.msgOpen })}
        >
          <span className="caret">▸</span> Terms
          <span className="reveal-sum">{state.terms ? (selectedTerm?.t ?? "attached") : "none"}</span>
        </div>
        <div className="reveal-body">
          {/* The select's aria-label is gone: it outranked the visible label, so the
              label was decorative and getByLabelText matched nothing. */}
          <Field
            label="Terms"
            hint={
              <span className="muted">
                (shown on the quote page — attached as written now)
              </span>
            }
          >
            <SelectMenu
              value={state.terms?.id ?? ""}
              onChange={selectTerms}
              options={[{ value: "", label: "None" }, ...terms.map((t) => ({ value: t.id, label: t.t }))]}
              style={{ maxWidth: 320 }}
            />
            {state.terms && (
              <p
                className="muted"
                style={{
                  fontSize: "var(--type-sm)",
                  whiteSpace: "pre-wrap",
                  margin: "var(--space-2) 0 0",
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {state.terms.text}
              </p>
            )}
          </Field>
        </div>
      </div>
    </div>
  );
}
