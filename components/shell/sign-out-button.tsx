"use client";
import { signOut } from "@/features/auth/hooks";

export function SignOutButton() {
  return (
    <button
      style={{ color: "var(--ink-2)", fontSize: "var(--type-sm)", textDecoration: "underline" }}
      onClick={async () => {
        await signOut();
        location.assign("/login");
      }}
    >
      Sign out
    </button>
  );
}
