"use client";
import { signOut } from "@/features/auth/hooks";

export function SignOutButton() {
  return (
    <button
      className="text-sm underline" style={{ color: "var(--ink-2)" }}
      onClick={async () => {
        await signOut();
        location.assign("/login");
      }}
    >
      Sign out
    </button>
  );
}
