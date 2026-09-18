import type { ButtonHTMLAttributes } from "react";

/**
 * The one button primitive — renders the prototype `.btn` so every button in the
 * app shares one look, one height set, and one focus ring (from the global
 * :focus-visible rule). Variant/size map to prototype modifier classes; no
 * Tailwind, no per-surface style hacks.
 */
const VARIANT = {
  primary: "primary",
  quiet: "ghost",
  danger: "danger",
  // The amber "one click and it's real" action — an approved outbound text on a card. It was
  // already a prototype variant (.btn.approve) reached by hand-writing the class; naming it here
  // is what lets the send surfaces compose the primitive instead of hand-rolling a <button>.
  approve: "approve",
} as const;

const SIZE = {
  sm: "sm",
  md: "",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
};

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  const cls = ["btn", VARIANT[variant], SIZE[size], className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...props} />;
}
