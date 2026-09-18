"use client";

/**
 * The inspector rail — the mock's docked right column. Select a line in the ledger and its
 * details dock here: quantity (with its math), unit cost, unit price, margin, tax, customer
 * visibility, section, scope. An assembly shows its driver and parts; a component shows the
 * assembly it belongs to.
 *
 * The row stays the fast path: description, quantity and price are still edited in place. The
 * rail is where the SECOND-ORDER facts live — the ones that used to be chips crowding the row
 * (Optional, No tax) or hints under it. One property editor is open at a time, exactly like
 * the mock, because two open editors in a 290px column is a form.
 *
 * Anchored and in-flow (a grid column, not a popover) — what the no-floating-UI rule asks.
 */

import { useRef, useState } from "react";
import { uploadProposalPhoto } from "@/lib/store/upload-proposal-photo";
import { fmt$rate } from "@/lib/format";
import type { ComposerLine } from "./composer-state";
import {
  componentIndexes,
  isPlainQuantity,
  resolveQuantity,
  withMarkup,
  withTypedRate,
  impliedMarkupBps,
} from "./line-math";

type EditKey = "description" | "quantity" | "cost" | "price" | "section" | null;
type AccKey = "scope" | "files" | "assembly" | "more" | null;

export interface LineInspectorProps {
  lines: ComposerLine[];
  /** Index of the selected line. The rail never renders without one. */
  selected: number;
  sections: string[];
  /** Does the quote charge tax at all — the Tax row decides nothing without a rate. */
  taxed: boolean;
  onUpdate: (i: number, patch: Partial<ComposerLine>) => void;
  onReplace: (i: number, next: ComposerLine) => void;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  onAddComponent: (i: number) => void;
  /** Copy this line — an assembly comes with its parts. */
  onDuplicate: (i: number) => void;
}

const LINE_TYPE_LABELS = {
  material: "Material",
  labor: "Labor",
  equipment: "Equipment",
  subcontract: "Subcontract",
  other: "Other",
} as const;

export function LineInspector(props: LineInspectorProps) {
  const { lines, selected } = props;
  const line = lines[selected];
  // One editor and one accordion open at a time — the mock's model.
  const [edit, setEdit] = useState<EditKey>(null);
  const [acc, setAcc] = useState<AccKey>(null);
  if (!line) return null;

  const parent = line.parentIndex != null ? lines[line.parentIndex] : undefined;
  const components = componentIndexes(lines, selected);
  const isAssembly = components.length > 0;
  /**
   * The mock's two inspectors: a hand-typed line is SIMPLE — its quantity and price are edited
   * in the row, so the rail carries the qualitative facts (scope, attachments, tax, section).
   * The math rows dock only where the math lives somewhere other than the row: assemblies,
   * their parts, and lines priced from a cost or an expression.
   */
  const simple =
    !parent && !isAssembly && line.c == null && line.markupBps == null && !line.qtyExpr?.trim();
  const kind = parent ? "Assembly item" : isAssembly ? "Assembly" : "Line item";
  const quantity = resolveQuantity(line, parent);
  const toggleEdit = (key: EditKey) => setEdit((cur) => (cur === key ? null : key));
  const toggleAcc = (key: AccKey) => setAcc((cur) => (cur === key ? null : key));

  /* Scope — the customer-facing prose, edited where the rest of the line's detail lives. */
  const scopeAcc = (
    <>
      <button
        type="button"
        className="rail-acc"
        aria-expanded={acc === "scope"}
        onClick={() => toggleAcc("scope")}
      >
        Scope
        <span>
          {line.scope?.trim() ? "Added" : "None"} {acc === "scope" ? "⌄" : "›"}
        </span>
      </button>
      {acc === "scope" && (
        <div className="rail-accbody">
          <textarea
            rows={6}
            aria-label="Scope"
            placeholder="What is included and excluded…"
            value={line.scope ?? ""}
            onChange={(e) => props.onUpdate(selected, { scope: e.target.value || undefined })}
          />
        </div>
      )}
    </>
  );
  const filesAcc = (
    <AttachmentsAcc
      line={line}
      selected={selected}
      open={acc === "files"}
      onToggle={() => toggleAcc("files")}
      onUpdate={props.onUpdate}
    />
  );

  return (
    <div
      className="rail"
      data-testid="line-inspector"
      onKeyDown={(e) => {
        // The mock's Escape: close the open editor or accordion, keep focus in the rail.
        if (e.key !== "Escape") return;
        if (edit !== null) {
          e.stopPropagation();
          setEdit(null);
          (e.currentTarget.querySelector(".rail-prop") as HTMLElement | null)?.focus();
        } else if (acc !== null) {
          e.stopPropagation();
          setAcc(null);
          (e.currentTarget.querySelector(".rail-acc") as HTMLElement | null)?.focus();
        }
      }}
    >
      <div className="rail-head">
        <div className="rail-kicker">{kind}</div>
        {/* The mock's title is a BUTTON — the rail edits the description too, not just the row. */}
        <button
          type="button"
          className="rail-title"
          aria-expanded={edit === "description"}
          onClick={() => toggleEdit("description")}
        >
          {line.d.trim() || (isAssembly ? "Untitled assembly" : "New line item")}
        </button>
        {edit === "description" && (
          <div className="rail-editor">
            <input
              aria-label="Description"
              placeholder="Describe the work…"
              value={line.d}
              onChange={(e) => props.onUpdate(selected, { d: e.target.value })}
            />
          </div>
        )}
        {parent ? (
          <p className="rail-sub">Inside {parent.d.trim() || "an assembly"}</p>
        ) : isAssembly ? (
          <p className="rail-sub">
            {quantity.value}
            {line.unit ? ` ${line.unit}` : ""} · {components.length} item
            {components.length === 1 ? "" : "s"} ·{" "}
            {line.custItems ? "Customer itemized" : "Customer summary"}
          </p>
        ) : null}
      </div>

      {/* The mock's SIMPLE inspector reads Scope → Attachments → the property rows; the full
          inspector leads with the math and files follow the scope. Same pieces, two orders. */}
      {simple && scopeAcc}
      {simple && filesAcc}
      <div>
        {!simple && (
          <>
            <QuantityProp
              {...props}
              line={line}
              parent={parent}
              isAssembly={isAssembly}
              open={edit === "quantity"}
              onToggle={() => toggleEdit("quantity")}
            />
            {/* A part's money rides its parent — the mock keeps a child's cost and markup in
                More details and shows no price/margin rows for it at all. */}
            {!parent && (
              <CostPriceProps
                {...props}
                line={line}
                parent={parent}
                isAssembly={isAssembly}
                edit={edit}
                onToggle={toggleEdit}
              />
            )}
          </>
        )}
        {/* Tax renders only when the quote charges tax — otherwise it decides nothing.
            A component's money rides its parent, so the parent's row is the one that counts. */}
        {props.taxed && !parent && (
          <button
            type="button"
            className="rail-prop"
            onClick={() => props.onUpdate(selected, { notax: !line.notax })}
          >
            <span className="k">Tax</span>
            <span className="v">{line.notax ? "No tax" : "Taxable"}</span>
          </button>
        )}
        {!parent && (
          <button
            type="button"
            className="rail-prop"
            onClick={() => props.onUpdate(selected, { hidden: !line.hidden })}
          >
            <span className="k">On customer copy</span>
            <span className="v">{line.hidden ? "Hidden" : "Shown"}</span>
          </button>
        )}
        {!parent && props.sections.length > 0 && (
          <>
            <button type="button" className="rail-prop" onClick={() => toggleEdit("section")}>
              <span className="k">Section</span>
              <span className="v">
                {line.sectionIndex != null ? (props.sections[line.sectionIndex] ?? "None") : "None"}
              </span>
            </button>
            {edit === "section" && (
              <div className="rail-editor">
                <select
                  aria-label="Section"
                  value={line.sectionIndex ?? ""}
                  onChange={(e) => {
                    const at = e.target.value === "" ? undefined : Number(e.target.value);
                    // Replace, not patch: leaving a section must DROP the key, and a patch can
                    // only set one.
                    const { sectionIndex: _out, ...rest } = line;
                    props.onReplace(selected, at === undefined ? rest : { ...rest, sectionIndex: at });
                  }}
                >
                  <option value="">None</option>
                  {props.sections.map((name, at) => (
                    <option key={at} value={at}>
                      {name || `Section ${at + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {!simple && scopeAcc}
      {!simple && filesAcc}

      {isAssembly && (
        <>
          <button
            type="button"
            className="rail-acc"
            aria-expanded={acc === "assembly"}
            onClick={() => toggleAcc("assembly")}
          >
            Assembly
            <span>
              {components.length} item{components.length === 1 ? "" : "s"} {acc === "assembly" ? "⌄" : "›"}
            </span>
          </button>
          {acc === "assembly" && (
            <div className="rail-accbody">
              {components.map((at) => {
                const component = lines[at]!;
                const count = resolveQuantity(component, line);
                return (
                  <button
                    key={at}
                    type="button"
                    className="rail-comp"
                    onClick={() => props.onSelect(at)}
                  >
                    <span className="rc-name">{component.d.trim() || "New line item"}</span>
                    <span className="rc-fig">
                      {count.valid ? count.value : "?"}
                      {component.unit ? ` ${component.unit}` : ""} · {fmt$rate(component.c ?? 0)}
                    </span>
                  </button>
                );
              })}
              <div className="rail-actions">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => props.onAddComponent(selected)}
                >
                  + Add item
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {parent && (
        <>
          <button
            type="button"
            className="rail-acc"
            aria-expanded={acc === "assembly"}
            onClick={() => toggleAcc("assembly")}
          >
            Assembly<span>Part of one {acc === "assembly" ? "⌄" : "›"}</span>
          </button>
          {acc === "assembly" && (
            <div className="rail-accbody">
              <p className="rail-hint" style={{ margin: 0 }}>
                This item belongs to {parent.d.trim() || "an assembly"}. Select the assembly in
                the estimate to manage all of its parts.
              </p>
              <div className="rail-actions">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => props.onSelect(line.parentIndex!)}
                >
                  Go to assembly
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <button
        type="button"
        className="rail-acc"
        aria-expanded={acc === "more"}
        onClick={() => toggleAcc("more")}
      >
        More details
        <span>
          {line.opt ? "Optional" : "Required"} {acc === "more" ? "⌄" : "›"}
        </span>
      </button>
      {acc === "more" && (
        <div className="rail-accbody">
          <div className="rail-editor" style={{ marginBottom: "var(--space-2)" }}>
            <select
              aria-label="Line type"
              value={line.ltype ?? ""}
              onChange={(e) =>
                props.onUpdate(selected, {
                  ltype: (e.target.value || undefined) as ComposerLine["ltype"],
                })
              }
            >
              <option value="">Type — none</option>
              {Object.entries(LINE_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {parent && (
            <div className="rail-grid2" style={{ marginBottom: "var(--space-2)" }}>
              <input
                inputMode="decimal"
                aria-label="Unit cost"
                placeholder="Unit cost"
                value={line.c ?? ""}
                onChange={(e) => {
                  const c = Number(e.target.value);
                  props.onUpdate(selected, { c: Number.isFinite(c) && c > 0 ? c : undefined });
                }}
              />
              <input
                inputMode="decimal"
                aria-label="Markup percent"
                placeholder="Markup %"
                value={line.markupBps != null ? Math.round(line.markupBps / 100) : ""}
                onChange={(e) =>
                  props.onReplace(selected, withMarkup(line, (Number(e.target.value) || 0) * 100))
                }
              />
            </div>
          )}
          {parent ? (
            <>
              <p className="rail-hint" style={{ margin: 0 }}>
                Tax and optional status follow the parent assembly.
              </p>
              <div className="rail-actions">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => props.onDuplicate(selected)}
                >
                  Duplicate item
                </button>
              </div>
            </>
          ) : (
            <div className="rail-actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn sm"
                aria-pressed={Boolean(line.opt)}
                title="Optional add-on — the customer can add or skip this on their quote page"
                onClick={() => props.onUpdate(selected, { opt: !line.opt })}
              >
                {line.opt ? "Optional" : "Required"}
              </button>
              <button
                type="button"
                className="btn sm"
                title="Copy this line — an assembly comes with its parts"
                onClick={() => props.onDuplicate(selected)}
              >
                Duplicate line
              </button>
              {isAssembly && (
                <button
                  type="button"
                  className="btn sm"
                  aria-pressed={Boolean(line.custItems)}
                  title="What the customer's copy shows under this line — the parts by name (marked Included), or the one summary line"
                  onClick={() => {
                    // Replace, not patch: turning the choice back off must DROP the key — the
                    // exception is stated only while it holds, like notax and hidden.
                    const { custItems: _out, ...rest } = line;
                    props.onReplace(selected, line.custItems ? rest : { ...rest, custItems: true });
                  }}
                >
                  {line.custItems ? "Customer sees items" : "Customer sees summary"}
                </button>
              )}
            </div>
          )}
          <div className="rail-actions">
            <button
              type="button"
              className="btn sm"
              onClick={() => props.onRemove(selected)}
            >
              {parent ? "Remove this item" : isAssembly ? "Remove assembly" : "Remove line"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Attachments — photos pinned to the line as office reference material ("this is the panel").
 * Uploaded through the same org-wide storage the proposal's photos use; never rendered on the
 * customer copy.
 */
function AttachmentsAcc({
  line,
  selected,
  open,
  onToggle,
  onUpdate,
}: {
  line: ComposerLine;
  selected: number;
  open: boolean;
  onToggle: () => void;
  onUpdate: (i: number, patch: Partial<ComposerLine>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const att = line.att ?? [];

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const key = await uploadProposalPhoto(file);
      onUpdate(selected, { att: [...att, { key, name: file.name }] });
    } catch {
      setError("That photo didn’t upload — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="rail-acc"
        aria-expanded={open}
        onClick={onToggle}
      >
        Attachments
        <span>
          {att.length > 0 ? att.length : "None"} {open ? "⌄" : "›"}
        </span>
      </button>
      {open && (
        <div className="rail-accbody">
          {att.map((a, at) => (
            <div key={a.key} className="rail-file">
              <span className="rail-file-name">{a.name}</span>
              <button
                type="button"
                className="lineedit-tool"
                aria-label={`Remove attachment ${a.name}`}
                onClick={() =>
                  onUpdate(selected, {
                    att: att.filter((_, i) => i !== at).length
                      ? att.filter((_, i) => i !== at)
                      : undefined,
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <div className="rail-actions" style={{ marginTop: att.length ? "var(--space-2)" : 0 }}>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Uploading…" : "+ Attach photo"}
            </button>
          </div>
          {error && (
            <p className="rail-hint" role="alert" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void attach(file);
            }}
          />
        </div>
      )}
    </>
  );
}

/** Quantity: value reads "qty/8+1 = 14 ea" for math, "100 LF" for a plain count. */
function QuantityProp({
  line,
  parent,
  isAssembly,
  selected,
  open,
  onToggle,
  onUpdate,
}: LineInspectorProps & {
  line: ComposerLine;
  parent: ComposerLine | undefined;
  isAssembly: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const quantity = resolveQuantity(line, parent);
  const typed = line.qtyExpr ?? String(line.q ?? 0);
  const computed = `${quantity.value}${line.unit ? ` ${line.unit}` : ""}`;
  const value = !quantity.valid
    ? "Check the math"
    : isPlainQuantity(typed)
      ? computed
      : `${typed} = ${computed}`;
  const label = isAssembly ? "Driver quantity" : "Quantity";
  return (
    <>
      <button type="button" className="rail-prop" onClick={onToggle}>
        <span className="k">{label}</span>
        <span className={`v${quantity.valid ? "" : " bad"}`}>{value}</span>
      </button>
      {open && (
        <div className="rail-editor">
          <div className="rail-grid2">
            <input
              inputMode={isPlainQuantity(typed) ? "decimal" : "text"}
              aria-label={parent ? "Quantity or math" : label}
              aria-invalid={quantity.valid ? undefined : true}
              value={typed}
              onChange={(e) => {
                const next = e.target.value;
                if (isPlainQuantity(next)) {
                  onUpdate(selected, { qtyExpr: undefined, q: Number(next.replace(/,/g, "")) });
                } else {
                  const resolved = resolveQuantity({ ...line, qtyExpr: next }, parent);
                  onUpdate(selected, { qtyExpr: next, q: resolved.value });
                }
              }}
            />
            <input
              aria-label="Unit"
              placeholder="LF, ea…"
              value={line.unit ?? ""}
              onChange={(e) => onUpdate(selected, { unit: e.target.value || undefined })}
            />
          </div>
          {parent && (
            <>
              <div className="rail-actions" style={{ marginTop: "var(--space-2)" }}>
                <button
                  type="button"
                  className="btn sm"
                  aria-pressed={Boolean(line.roundUp)}
                  title="Round the count up to a whole unit — you cannot buy half a post"
                  onClick={() => onUpdate(selected, { roundUp: !line.roundUp })}
                >
                  {line.roundUp ? "✓ Round up" : "Round up"}
                </button>
              </div>
              <p className="rail-hint">
                <b>qty</b> = the assembly&rsquo;s quantity ({parent.q ?? 0}
                {parent.unit ? ` ${parent.unit}` : ""}). Type a number or math with it — e.g.{" "}
                <b>qty/8+1</b>.
              </p>
            </>
          )}
          {isAssembly && (
            <p className="rail-hint">
              Item counts scale from this number — use <b>qty</b> in any item&rsquo;s quantity
              math, e.g. <b>qty/8+1</b>.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Unit cost, unit price and margin — the money rows. A rolled-up price is stated, not edited. */
function CostPriceProps({
  line,
  parent,
  isAssembly,
  selected,
  edit,
  onToggle,
  onUpdate,
  onReplace,
}: LineInspectorProps & {
  line: ComposerLine;
  parent: ComposerLine | undefined;
  isAssembly: boolean;
  edit: EditKey;
  onToggle: (key: EditKey) => void;
}) {
  const pricedByParts = isAssembly;
  const margin =
    line.c != null && line.c > 0 && (line.r ?? 0) > 0
      ? Math.round((100 * ((line.r ?? 0) - line.c)) / (line.r ?? 1))
      : null;
  return (
    <>
      <button type="button" className="rail-prop" onClick={() => onToggle("cost")}>
        <span className="k">Unit cost</span>
        <span className="v">{line.c != null ? fmt$rate(line.c) : "—"}</span>
      </button>
      {edit === "cost" && (
        <div className="rail-editor">
          <input
            inputMode="decimal"
            aria-label="Unit cost"
            value={line.c ?? ""}
            placeholder="What you pay"
            onChange={(e) => {
              const c = Number(e.target.value);
              onUpdate(selected, { c: Number.isFinite(c) && c > 0 ? c : undefined });
            }}
          />
          {line.markupBps != null && (
            <p className="rail-hint">
              Priced from cost at {Math.round(impliedMarkupBps(line) / 100)}% markup — changing
              the cost reprices the line.
            </p>
          )}
        </div>
      )}

      {pricedByParts ? (
        <div className="rail-prop">
          <span className="k">Unit price</span>
          <span className="v">{fmt$rate(line.r ?? 0)} · from items</span>
        </div>
      ) : (
        <>
          <button type="button" className="rail-prop" onClick={() => onToggle("price")}>
            <span className="k">Unit price</span>
            <span className="v">{fmt$rate(line.r ?? 0)}</span>
          </button>
          {edit === "price" && (
            <div className="rail-editor">
              <div className="rail-grid2">
                <input
                  inputMode="decimal"
                  aria-label="Unit price"
                  value={line.r ?? 0}
                  onChange={(e) => onReplace(selected, withTypedRate(line, Number(e.target.value) || 0))}
                />
                <input
                  inputMode="decimal"
                  aria-label="Markup percent"
                  placeholder="Markup %"
                  value={line.markupBps != null ? Math.round(line.markupBps / 100) : ""}
                  title="Markup over your cost. Editing it prices this line FROM the cost."
                  onChange={(e) => onReplace(selected, withMarkup(line, (Number(e.target.value) || 0) * 100))}
                />
              </div>
            </div>
          )}
        </>
      )}

      <div className="rail-prop">
        <span className="k">Margin</span>
        <span className={`v${margin !== null && margin > 0 ? " good" : ""}`}>
          {margin !== null ? `${margin}%` : "—"}
        </span>
      </div>
    </>
  );
}
