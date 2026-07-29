"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEnsureProvisioned } from "@/features/identity/hooks";
import { userMessage } from "@/lib/trpc/error-map";

/**
 * The one screen between signing in and having a workspace.
 *
 * This used to fire provisioning automatically on mount with no input at all — the business name
 * was guessed from the email domain. It now asks two questions, because neither answer can be
 * recovered later without asking anyway:
 *
 *  - the business name;
 *  - the ZIP, which decides the AREA CODE of the phone number bought for this shop.
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

  // Five digits or nothing. An almost-right ZIP falls through to a national number search, which
  // is the exact outcome asking for it was meant to avoid.
  const zipLooksRight = /^\d{5}$/.test(postalCode.trim());
  const canSubmit = orgName.trim().length > 0 && zipLooksRight && !provision.isPending;

  function submit() {
    if (!canSubmit) return;
    provision.mutate(
      { orgName: orgName.trim(), postalCode: postalCode.trim() },
      { onSuccess: (me) => router.replace(me.role === "tech" ? "/my-day" : "/dashboard") },
    );
  }

  return (
    <Card>
      <h1 style={{ fontSize: "var(--type-lg)", fontWeight: 800, margin: "0 0 var(--space-2)" }}>
        Set up your workspace
      </h1>
      <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        Two questions, then you&rsquo;re in.
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

      <p style={{ fontSize: "var(--type-sm)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        We&rsquo;ll get you a business number in your area code. Your customers see that number
        instead of anyone&rsquo;s personal phone.
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
