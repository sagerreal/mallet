"use client";
import { signOut } from "@/features/auth/hooks";

export function SignOutButton() {
  return (
    <button
      className="text-sm text-ink-muted underline"
      onClick={async () => {
        await signOut();
        location.assign("/login");
      }}
    >
      Sign out
    </button>
  );
}
