import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  quiet: "border border-line bg-transparent text-ink hover:bg-paper",
  danger: "bg-red-bg text-red hover:opacity-90",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants };

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
