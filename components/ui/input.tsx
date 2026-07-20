import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

/**
 * The field layer — Field (label + control) plus Input/Select that inherit the
 * prototype `.field` styling. Wrapping in `.field` means the descendant rules in
 * prototype.css style the control; no per-input class needed.
 */
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
