"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEnsureProvisioned } from "@/features/identity/hooks";
import { userMessage } from "@/lib/trpc/error-map";
import { zipToTimezone, TZ_LABEL } from "@/lib/geo/zip-timezone";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { TRADE_PLAYBOOKS } from "@/app/(office)/settings/trade-playbooks";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The one screen between signing in and having a workspace — the welcome survey.
 *
 * It is deliberately NOT part of the signup form. Every field on a signup form costs completions
 * (a three-field form converts 2-3x better than one with six), so the account is created first and
 * the questions that configure the product are asked here, once the person is committed. Same
 * split Jobber uses: name/email/business at signup, then industry and setup questions after.
 *
 * THREE questions, and the business name is not one of them — it was typed at signup, rides in
 * `user_metadata.org_name`, and is prefilled here to be glanced at rather than retyped.
 *
 *  - TRADE, which decides the front desk's starter playbook and the shop's pricebook. Without it
 *    every org got the plumbing pack: a roofer's first look at their own pricebook was "Replace
 *    40gal gas water heater, $2,400".
 *  - ZIP, which decides the AREA CODE of the phone number bought for this shop AND the org's
 *    timezone (otherwise America/Los_Angeles forever, which the AI front desk reads when it offers
 *    appointment times). The number cannot be swapped afterwards without buying another one and
 *    telling every customer who already has the old one.
 *  - The owner's MOBILE, which fills users.callback_number — click-to-call has no other way to
 *    learn it, and 1 user out of 81 currently has one set.
 *
 * Styled with the `auth-*` system, like every other screen in this route group. It used to compose
 * the OFFICE primitives (Card/Field/Input/Button), so the last screen of the signup journey looked
 * like it belonged to a different product than the two before it.
 */
export default function WelcomePage() {
  const router = useRouter();
  const provision = useEnsureProvisioned();
  const hydrated = useHydrated();

  const [orgName, setOrgName] = useState("");
  const [trade, setTrade] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [mobile, setMobile] = useState("");

  /**
   * Stays true from the moment provisioning succeeds until this component is gone.
   *
   * `provision.isPending` flips back to false the instant the mutation resolves, and the
   * navigation that follows takes another beat — so the button reverted to "Create workspace"
   * and sat there looking un-pressed before the page changed. It read as a failed click, and on
   * mobile, where navigation is slower, it read as a broken app.
   */
  const [leaving, setLeaving] = useState(false);
  const busy = provision.isPending || leaving;

  // The business name was typed at signup and rides in the auth session's user_metadata — the
  // server already reads it as `orgNameHint`. Prefilled rather than re-asked; still editable,
  // because a typo made at signup has no other place to be corrected before the org exists.
  useEffect(() => {
    let cancelled = false;
    void createSupabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        const hint = data.session?.user.user_metadata?.org_name;
        if (!cancelled && typeof hint === "string" && hint.trim()) setOrgName(hint.trim());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Five digits or nothing. An almost-right ZIP falls through to a national number search, which
  // is the exact outcome asking for it was meant to avoid.
  const zipLooksRight = /^\d{5}$/.test(postalCode.trim());
  const timezone = zipToTimezone(postalCode);
  // 10 digits is a US number; 11 with a leading 1 is the same number written differently.
  const mobileDigits = mobile.replace(/\D/g, "");
  const mobileLooksRight = mobileDigits.length === 10 || (mobileDigits.length === 11 && mobileDigits.startsWith("1"));
  const canSubmit =
    orgName.trim().length > 0 && trade.length > 0 && zipLooksRight && mobileLooksRight && !busy && hydrated;

  function submit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!canSubmit) return;
    provision.mutate(
      {
        orgName: orgName.trim(),
        trade,
        postalCode: postalCode.trim(),
        // Omitted rather than defaulted when the ZIP is unknown: the org keeps the column default
        // and the Settings control is where it gets corrected.
        ...(timezone ? { timezone } : {}),
      },
      {
        onSuccess: (me) => {
          setLeaving(true);
          // Fire-and-forget: provisioning is the write that matters, and a failed callback save
          // must not strand the shop outside the workspace it just created. It is recoverable
          // from Settings; being locked out of the app is not.
          //
          // Still must not swallow the failure silently — this field exists precisely because
          // only 1 of 81 users had a callback number set, and a silent .catch() here reproduces
          // that exact bug with no trace. Matches the store's reportWriteError dev-log convention.
          void trpcVanilla.v1.calls.setCallbackNumber.mutate({ callbackNumber: mobile }).catch((err: unknown) => {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.error("[welcome] setCallbackNumber failed — mobile was not saved", err);
            }
          });
          router.replace(me.role === "tech" ? "/my-day" : "/dashboard");
        },
      },
    );
  }

  return (
    <>
      <h1 className="auth-title">Set up your shop</h1>
      <p className="auth-sub">Three answers and you&rsquo;re in.</p>

      <form onSubmit={submit} method="post">
        <label className="auth-field">
          <span>Business name</span>
          <input
            className="auth-input"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            enterKeyHint="next"
            maxLength={80}
            required
          />
        </label>

        <label className="auth-field">
          <span>Trade</span>
          <select
            className="auth-input"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            required
          >
            <option value="" disabled>
              Pick your trade
            </option>
            {TRADE_PLAYBOOKS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="auth-field">
          <span>ZIP code</span>
          <input
            className="auth-input"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="02189"
            inputMode="numeric"
            enterKeyHint="next"
            autoComplete="postal-code"
            required
          />
        </label>

        <label className="auth-field">
          <span>Your mobile</span>
          <input
            className="auth-input"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="(617) 555-0142"
            inputMode="tel"
            enterKeyHint="go"
            autoComplete="tel"
            required
            aria-describedby="mobile-hint"
          />
        </label>
        {/* OUTSIDE the label on purpose: a <span> inside one becomes part of the control's
            accessible name, so screen readers (and getByLabelText) would read the whole hint as
            the field's name. aria-describedby attaches it as description instead. */}
        <p className="auth-hint" id="mobile-hint">
          We ring this and bridge the call, so customers only ever see your business number.
          {timezone ? ` Times show in ${TZ_LABEL[timezone] ?? timezone}.` : ""}
        </p>

        {provision.isError && <p className="auth-error">{userMessage(provision.error)}</p>}

        <button className="auth-submit" type="submit" disabled={!canSubmit}>
          {busy ? "Setting up…" : "Create workspace"}
        </button>
      </form>
    </>
  );
}
