"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEnsureProvisioned } from "@/features/identity/hooks";
import { userMessage } from "@/lib/trpc/error-map";
import { zipToTimezone } from "@/lib/geo/zip-timezone";
import { trpcVanilla } from "@/lib/trpc/vanilla";

/** Plain names for the zones the ZIP table can produce. A shop reads "Eastern", not "America/New_York". */
const TZ_LABEL: Record<string, string> = {
  "America/New_York": "Eastern time",
  "America/Chicago": "Central time",
  "America/Denver": "Mountain time",
  "America/Phoenix": "Arizona time",
  "America/Los_Angeles": "Pacific time",
  "America/Anchorage": "Alaska time",
  "Pacific/Honolulu": "Hawaii time",
  "America/Puerto_Rico": "Atlantic time",
};

/**
 * The one screen between signing in and having a workspace.
 *
 * This used to fire provisioning automatically on mount with no input at all — the business name
 * was guessed from the email domain. It now asks three questions, because none of the answers can
 * be recovered later without asking anyway:
 *
 *  - the business name;
 *  - the ZIP, which decides the AREA CODE of the phone number bought for this shop, AND the org's
 *    timezone (otherwise America/Los_Angeles forever with no UI to correct it);
 *  - the owner's mobile, which fills users.callback_number — click-to-call has no other way to
 *    learn it, and 1 user out of 81 currently has one set.
 *
 * The ZIP matters more than it looks. A plumber in Weymouth handing customers a 669 California
 * number looks wrong on a truck and on a voicemail, and the number cannot be swapped afterwards
 * without buying another one and telling every customer who already has the old one.
 */
export default function WelcomePage() {
  const router = useRouter();
  const provision = useEnsureProvisioned();
  const [orgName, setOrgName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [mobile, setMobile] = useState("");

  // Five digits or nothing. An almost-right ZIP falls through to a national number search, which
  // is the exact outcome asking for it was meant to avoid.
  const zipLooksRight = /^\d{5}$/.test(postalCode.trim());
  const timezone = zipToTimezone(postalCode);
  // 10 digits is a US number; 11 with a leading 1 is the same number written differently.
  const mobileDigits = mobile.replace(/\D/g, "");
  const mobileLooksRight = mobileDigits.length === 10 || (mobileDigits.length === 11 && mobileDigits.startsWith("1"));
  const canSubmit =
    orgName.trim().length > 0 && zipLooksRight && mobileLooksRight && !provision.isPending;

  function submit() {
    if (!canSubmit) return;
    provision.mutate(
      {
        orgName: orgName.trim(),
        postalCode: postalCode.trim(),
        // Omitted rather than defaulted when the ZIP is unknown: the org keeps the column default
        // and the Settings control is where it gets corrected.
        ...(timezone ? { timezone } : {}),
      },
      {
        onSuccess: (me) => {
          // Fire-and-forget: provisioning is the write that matters, and a failed callback save
          // must not strand the shop outside the workspace it just paid attention to create.
          // It is recoverable from Settings; being locked out of the app is not.
          void trpcVanilla.v1.calls.setCallbackNumber.mutate({ callbackNumber: mobile }).catch(() => {});
          router.replace(me.role === "tech" ? "/my-day" : "/dashboard");
        },
      },
    );
  }

  return (
    <Card>
      <h1 style={{ fontSize: "var(--type-lg)", fontWeight: 800, margin: "0 0 var(--space-2)" }}>
        Set up your workspace
      </h1>
      <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        Three questions, then you&rsquo;re in.
      </p>

      <Field label="Business name">
        <Input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="e.g. Summit Plumbing"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>

      <Field label="ZIP code">
        <Input
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="02189"
          inputMode="numeric"
          autoComplete="postal-code"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>

      <Field label="Your mobile">
        <Input
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="(617) 555-0142"
          inputMode="tel"
          autoComplete="tel"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>

      <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        We&rsquo;ll get you a business number in your area code. Your customers see that number
        instead of anyone&rsquo;s personal phone — we ring your mobile and bridge the call.
        {timezone ? ` Times will show in ${TZ_LABEL[timezone] ?? timezone}; change it in Settings.` : ""}
      </p>

      {provision.isError && (
        <p role="alert" style={{ fontSize: "var(--type-sm)", color: "var(--red)", margin: "0 0 var(--space-3)" }}>
          {userMessage(provision.error)}
        </p>
      )}

      <Button onClick={submit} disabled={!canSubmit}>
        {provision.isPending ? "Setting up…" : "Create workspace"}
      </Button>
    </Card>
  );
}
