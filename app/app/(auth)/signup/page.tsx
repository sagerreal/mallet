import Link from "next/link";

/**
 * Mallet is invite-only while in pilot — the signup form is gone, not hidden.
 *
 * The page stays (old links, app-store listings and password managers still point here) but it
 * states the actual door: an invite from a team's owner. The real gate is server-side — the
 * identity.signup mutation refuses to provision a fresh org for an uninvited email, and the
 * Supabase project no longer accepts public auth signups — so this page is honest copy over a
 * closed door, not the closure itself.
 *
 * Reopening self-serve signup = restore the form here (git history has it), set SIGNUPS_OPEN=1,
 * and re-enable "allow new users to sign up" in the Supabase dashboard.
 */
export default function SignupPage() {
  return (
    <>
      <h1 className="auth-title">Mallet is invite-only right now</h1>
      <p className="auth-sub">
        New workspaces are set up by the Mallet team. If your company already uses Mallet, ask
        the owner to invite you — the invite email has everything you need.
      </p>
      <div className="auth-links" style={{ justifyContent: "center" }}>
        <Link href="/login">Already have an account? Sign in</Link>
      </div>
    </>
  );
}
