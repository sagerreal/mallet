"use client";

/**
 * The A2P 10DLC business-info form — collects everything
 * BeginA2pRegistrationUseCase needs (legal name, address, industry, website,
 * optional EIN, contact, and a consent attestation) and submits via
 * v1.a2p.submitAndRegister. Pre-fills what Mallet already knows (brand name +
 * site from the brand store, contact name/email from v1.identity.me) — mirrors
 * BrandingCard's dirty-guarded re-sync so an in-progress edit never gets
 * clobbered by a query resolving late.
 *
 * EIN is optional (brandKind() in the domain treats a null EIN as a sole
 * proprietor) — staged behind a DisclosureRow since it's the one truly
 * optional field, not one of the form's core essentials.
 */

import { useState, useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { A2pConsentPreview } from "./a2p-consent-preview";

interface A2pBusinessFormProps {
  /** Called after a successful submit — the card uses this to collapse the form. */
  onSubmitted?: () => void;
}

// businessInfoDTO requires a real URL (z.url()); tolerate a bare domain the way the
// rest of the app does (brand.site stores things like "r.com", no scheme).
function normalizeWebsite(v: string): string {
  const trimmed = v.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function splitName(name: string | null | undefined): { first: string; last: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// Names the first missing/invalid field so the error is actionable, not generic.
function validationError(draft: {
  legalName: string;
  addressStreet: string;
  addressCity: string;
  addressRegion: string;
  addressPostal: string;
  industry: string;
  websiteUrl: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  consentAttested: boolean;
}): string | null {
  if (!draft.legalName.trim()) return "Enter your legal business name.";
  if (!draft.addressStreet.trim() || !draft.addressCity.trim() || !draft.addressRegion.trim() || !draft.addressPostal.trim()) {
    return "Enter your business address.";
  }
  if (!draft.industry.trim()) return "Enter your industry — e.g. Plumbing, HVAC, Electrical.";
  if (!draft.websiteUrl.trim()) return "Enter your business website.";
  if (!draft.contactFirstName.trim() || !draft.contactLastName.trim()) return "Enter a contact name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contactEmail.trim())) return "Enter a valid contact email.";
  if (!draft.contactPhone.trim()) return "Enter a contact phone number.";
  if (!draft.consentAttested) return "Confirm your customers opt in to texting before submitting.";
  return null;
}

export function A2pBusinessForm({ onSubmitted }: A2pBusinessFormProps) {
  const utils = api.useUtils();
  const brand = useAppStore((s) => s.brand);
  const { data: me } = api.v1.identity.me.useQuery();

  const [legalName, setLegalName] = useState(brand.name);
  const [ein, setEin] = useState("");
  const [einOpen, setEinOpen] = useState(false);
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressRegion, setAddressRegion] = useState("");
  const [addressPostal, setAddressPostal] = useState("");
  const [industry, setIndustry] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState(brand.site);
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [consentAttested, setConsentAttested] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  // Re-sync the prefillable fields from brand/me while the owner hasn't started editing —
  // same dirty guard as BrandingCard, so an async me/brand resolve never yanks an in-progress
  // draft out from under the user.
  useEffect(() => {
    if (dirty) return;
    setLegalName(brand.name);
    setWebsiteUrl(brand.site);
    if (me) {
      setContactEmail(me.email);
      const { first, last } = splitName(me.name);
      setContactFirstName(first);
      setContactLastName(last);
    }
  }, [brand.name, brand.site, me, dirty]);

  const submit = api.v1.a2p.submitAndRegister.useMutation({
    onSuccess: () => {
      setFormError(null);
      setDirty(false);
      utils.v1.a2p.getStatus.invalidate().catch(() => {});
      flash();
      onSubmitted?.();
    },
    onError: (err) => {
      setFormError(err.message || "Couldn't submit — check your connection and try again.");
    },
  });

  function markDirty() {
    setDirty(true);
    resetSaved();
    if (formError) setFormError(null);
  }

  function handleSubmit() {
    const draft = {
      legalName,
      addressStreet,
      addressCity,
      addressRegion,
      addressPostal,
      industry,
      websiteUrl,
      contactFirstName,
      contactLastName,
      contactEmail,
      contactPhone,
      consentAttested,
    };
    const error = validationError(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    submit.mutate({
      legalName: legalName.trim(),
      ein: ein.trim() ? ein.trim() : null,
      addressStreet: addressStreet.trim(),
      addressCity: addressCity.trim(),
      addressRegion: addressRegion.trim(),
      addressPostal: addressPostal.trim(),
      industry: industry.trim(),
      websiteUrl: normalizeWebsite(websiteUrl),
      contactFirstName: contactFirstName.trim(),
      contactLastName: contactLastName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "var(--space-3)",
        marginTop: "var(--space-3)",
        paddingTop: "var(--space-3)",
        borderTop: "1px solid var(--line)",
      }}
    >
      <Field label="Legal business name">
        <Input
          value={legalName}
          onChange={(e) => { setLegalName(e.target.value); markDirty(); }}
        />
      </Field>

      <Field label="Street address">
        <Input
          value={addressStreet}
          placeholder="200 Ray St"
          onChange={(e) => { setAddressStreet(e.target.value); markDirty(); }}
        />
      </Field>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Field label="City">
          <Input value={addressCity} onChange={(e) => { setAddressCity(e.target.value); markDirty(); }} />
        </Field>
        <Field label="State">
          <Input value={addressRegion} placeholder="CA" onChange={(e) => { setAddressRegion(e.target.value); markDirty(); }} />
        </Field>
        <Field label="ZIP">
          <Input value={addressPostal} placeholder="94566" onChange={(e) => { setAddressPostal(e.target.value); markDirty(); }} />
        </Field>
      </div>

      <Field label="Industry">
        <Input
          value={industry}
          placeholder="e.g. Plumbing, HVAC, Electrical"
          onChange={(e) => { setIndustry(e.target.value); markDirty(); }}
        />
      </Field>

      <Field label="Website">
        <Input
          value={websiteUrl}
          placeholder="yourbusiness.com"
          onChange={(e) => { setWebsiteUrl(e.target.value); markDirty(); }}
        />
      </Field>

      <DisclosureRow
        label="EIN"
        value={ein.trim() || "Sole proprietor (none)"}
        open={einOpen}
        onToggle={() => setEinOpen((v) => !v)}
      >
        <Field label="EIN">
          <Input value={ein} placeholder="12-3456789" onChange={(e) => { setEin(e.target.value); markDirty(); }} />
        </Field>
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          Leave blank if you&apos;re a sole proprietor without one.
        </p>
      </DisclosureRow>

      <h4 style={{ margin: "var(--space-2) 0 0", fontSize: "var(--type-base)" }}>Contact</h4>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Field label="First name">
          <Input value={contactFirstName} onChange={(e) => { setContactFirstName(e.target.value); markDirty(); }} />
        </Field>
        <Field label="Last name">
          <Input value={contactLastName} onChange={(e) => { setContactLastName(e.target.value); markDirty(); }} />
        </Field>
      </div>
      <Field label="Contact email">
        <Input type="email" value={contactEmail} onChange={(e) => { setContactEmail(e.target.value); markDirty(); }} />
      </Field>
      <Field label="Contact phone">
        <Input
          type="tel"
          value={contactPhone}
          placeholder="(925) 555-0123"
          onChange={(e) => { setContactPhone(e.target.value); markDirty(); }}
        />
      </Field>

      <A2pConsentPreview legalName={legalName} />

      <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
        <input
          type="checkbox"
          checked={consentAttested}
          onChange={(e) => { setConsentAttested(e.target.checked); markDirty(); }}
        />
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          I confirm my customers agree to receive texts — by phone, in person, or through my
          website&apos;s booking or contact form.
        </span>
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <Button onClick={handleSubmit} disabled={submit.isPending}>
          {submit.isPending ? "Submitting…" : "Submit for approval"}
        </Button>
        <SavedFlash saved={saved}>Submitted ✓</SavedFlash>
      </div>

      {formError && (
        <p style={{ color: "var(--red-700, #b42318)", fontSize: "var(--type-sm)", margin: 0 }} role="alert">
          {formError}
        </p>
      )}
    </div>
  );
}
