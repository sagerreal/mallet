import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode, CSSProperties } from "react";

/**
 * The field layer — Field (label + control) plus Input/Select that inherit the
 * prototype `.field` styling. Wrapping in `.field` means the descendant rules in
 * prototype.css style the control; no per-input class needed.
 */

/**
 * The compact input treatment — smaller than the full-size `.field` control
 * (radius-sm, tighter padding, base type). Applied inline (not as a class) so it
 * keeps overriding the `.field input` descendant rule when a compact control
 * lives inside a `.field` container. Shared here instead of being redefined in
 * every dense settings/checklist/setup surface.
 */
export const COMPACT_INPUT: CSSProperties = {
  fontSize: "var(--type-base)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-sm)",
};
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  // Mirrors the prototype `.field` markup used across the app (div > label +
  // control), so the descendant rules in prototype.css style the control for free.
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
