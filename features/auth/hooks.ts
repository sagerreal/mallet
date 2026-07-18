"use client";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export const signIn = async (email: string, password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signInWithPassword({ email, password });
  return error ? "Email or password is incorrect." : null;
};

// The three ways a signup attempt can resolve. "exists" is distinct from "sent" because
// Supabase sends NO confirmation email for an already-registered address (see below), so the
// UI must not claim a link went out.
export type SignUpOutcome =
  | { kind: "sent" }
  | { kind: "exists" }
  | { kind: "error"; message: string };

// org_name AND the owner's display name ride in user_metadata so provisioning can read them
// AFTER email confirmation, when the signup form's state is long gone. The token verifier maps
// user_metadata.name → principal.name → app_signup_create_org(p_name) → users.name.
export const signUp = async (
  email: string,
  password: string,
  orgName: string,
  name: string,
): Promise<SignUpOutcome> => {
  const trimmedName = name.trim();
  const { data, error } = await createSupabaseBrowser().auth.signUp({
    email,
    password,
    options: {
      data: { org_name: orgName, ...(trimmedName ? { name: trimmedName } : {}) },
      emailRedirectTo: `${window.location.origin}/auth/confirm`,
    },
  });
  if (error) return { kind: "error", message: error.message };
  // Anti-enumeration: with email confirmation on, signing up an address that already has a
  // (confirmed) account returns HTTP 200 with an obfuscated user whose `identities` array is
  // EMPTY, and Supabase sends nothing. Detect that so the caller shows an honest "sign in"
  // message instead of a "check your email" screen for a link that was never sent.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { kind: "exists" };
  }
  return { kind: "sent" };
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  await createSupabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
};

export const updatePassword = async (password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.updateUser({ password });
  return error ? error.message : null;
};

// Invite-accept: an invited member sets their password AND their display name in one step.
// The name goes onto the auth user's user_metadata; refreshSession() then re-mints the access
// token so the fresh JWT carries user_metadata.name into provisioning at /welcome (the token
// established at /auth/callback predates this update). Provisioning writes it to users.name.
export const completeInvite = async (password: string, name: string): Promise<string | null> => {
  const supabase = createSupabaseBrowser();
  const trimmedName = name.trim();
  const { error } = await supabase.auth.updateUser({
    password,
    ...(trimmedName ? { data: { name: trimmedName } } : {}),
  });
  if (error) return error.message;
  await supabase.auth.refreshSession();
  return null;
};

export const signOut = async (): Promise<void> => {
  await createSupabaseBrowser().auth.signOut();
};
