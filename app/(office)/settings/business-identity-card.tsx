"use client";

/**
 * Settings → Workspace → "Business details".
 *
 * The four facts a customer needs on an invoice to know WHO billed them and how to act on it:
 * address, phone, email, licence number. Until these existed the invoice a customer received
 * carried the shop's name and nothing else — no address, no phone, no licence — so there was no
 * way to query a bill except by finding the original text message.
 *
 * Sits beside Branding on purpose: both are "what the customer sees". Branding is how the shop
 * LOOKS on a document (colour, monogram, tagline); this is who it IS. Business name and website
 * are NOT repeated here — they are Branding's "Business name" and "Website", one field each.
 *
 * Own file rather than another block inside page.tsx, matching branding-card and
 * a2p-registration-card: a settings card owns its own file and its own test.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { userMessage } from "@/lib/trpc/error-map";
import { FoldCard } from "./fold-card";
import { MarkBusiness } from "./setting-marks";

const TITLE = "Business details";

/** The form's four values, all free text. "" means "not set" — the server stores null. */
interface Draft {
  address: string;
  phone: string;
  email: string;
  license: string;
}

const EMPTY: Draft = { address: "", phone: "", email: "", license: "" };

/** "" → null so a cleared field actually clears server-side instead of storing an empty string. */
const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

interface BusinessFieldsProps {
  readonly draft: Draft;
  /** Placeholder for the address input — the service-area origin when the shop has set one. */
  readonly addressHint: string;
  readonly onEdit: (patch: Partial<Draft>) => void;
}

/**
 * The four inputs. Plain business labels — no jargon: a shop owner reads "Phone customers should
 * call", not "Primary contact number". Composed from Field/Input so each label is programmatically
 * associated with its control (the a11y floor is enforcing at zero violations).
 */
function BusinessFields({ draft, addressHint, onEdit }: BusinessFieldsProps) {
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <Field label="Business address" style={{ margin: 0 }}>
        <Input
          type="text"
          value={draft.address}
          onChange={(e) => onEdit({ address: e.target.value })}
          placeholder={addressHint || "Street, city, state ZIP"}
        />
      </Field>
      <Field label="Phone customers should call" style={{ margin: 0 }}>
        <Input
          type="tel"
          value={draft.phone}
          onChange={(e) => onEdit({ phone: e.target.value })}
          placeholder="(925) 555-0100"
        />
      </Field>
      <Field label="Email for billing questions" style={{ margin: 0 }}>
        <Input
          type="email"
          value={draft.email}
          onChange={(e) => onEdit({ email: e.target.value })}
          placeholder="billing@yourbusiness.com"
        />
      </Field>
      <Field label="License number" style={{ margin: 0 }}>
        <Input
          type="text"
          value={draft.license}
          onChange={(e) => onEdit({ license: e.target.value })}
        />
      </Field>
    </div>
  );
}

export function BusinessIdentityCard() {
  const utils = api.useUtils();
  const settings = api.v1.settings.get.useQuery();
  const save = api.v1.settings.updateBusiness.useMutation();
  const { saved, flash, reset: resetSaved } = useSaveFlash();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);
  // dirty: set on the first edit, so a refetch resolving mid-typing cannot yank a half-typed
  // address out from under the user (same guard as BrandingCard).
  const [dirty, setDirty] = useState(false);

  const business = settings.data?.business;

  useEffect(() => {
    if (dirty || !business) return;
    setDraft({
      address: business.address ?? "",
      phone: business.phone ?? "",
      email: business.email ?? "",
      license: business.license ?? "",
    });
  }, [business, dirty]);

  // Gate on the real values having arrived. Empty inputs that look editable while the query is
  // still in flight invite a Save that writes four blanks over four real values.
  if (!settings.isFetched) {
    return (
      <FoldCard title={TITLE} mark={<MarkBusiness />} summary="Loading…">
        <p className="muted" style={{ fontSize: "var(--type-base)", margin: 0 }}>
          Loading…
        </p>
      </FoldCard>
    );
  }

  // The service-area origin, shown ONLY as a placeholder. It is a different fact — the point drive
  // time is measured from, often a yard — so copying it into the value would make an invoice edit
  // look like a routing change. Showing it lets a shop see the address it already typed once.
  const originHint = settings.data?.config.serviceOriginAddress?.trim() || "";

  function edit(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSaveError(null);
    resetSaved();
  }

  function handleSave() {
    setSaveError(null);
    save.mutate(
      {
        address: orNull(draft.address),
        phone: orNull(draft.phone),
        email: orNull(draft.email),
        license: orNull(draft.license),
      },
      {
        onSuccess: () => {
          void utils.v1.settings.get.invalidate();
          setDirty(false);
          flash();
        },
        onError: (err) => {
          setSaveError(userMessage(err, "Couldn't save your business details — try again."));
        },
      },
    );
  }

  return (
    <FoldCard title={TITLE} mark={<MarkBusiness />} summary={draft.address.trim() || "Not set"}>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>
        Printed on every invoice and quote you send.
      </p>

      <BusinessFields draft={draft} addressHint={originHint} onEdit={edit} />
      <SaveRow pending={save.isPending} saved={saved} error={saveError} onSave={handleSave} />
    </FoldCard>
  );
}

interface SaveRowProps {
  readonly pending: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
}

/** Commit-on-click, so the "Saved ✓" flash is the only sign it worked. A failure names itself. */
function SaveRow({ pending, saved, error, onSave }: SaveRowProps) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginTop: "var(--space-3)",
        }}
      >
        <Button onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <SavedFlash saved={saved} />
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          {error}
        </p>
      )}
    </>
  );
}
