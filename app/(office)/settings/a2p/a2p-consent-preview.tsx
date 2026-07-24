"use client";

/**
 * Read-only preview of the generated A2P consent language: the carrier-checked
 * opt-in paragraph, the 5 sample messages, the opt-in confirmation, and the SMS
 * Terms clause — exactly what BeginA2pRegistrationUseCase submits as
 * CampaignContent (and what the shop's Terms page should carry). Computed via
 * the v1.a2p.previewConsent server query (NOT by importing the generate-consent
 * module directly into this client component — that would pull the a2p module's
 * barrel/config validator client-side, per the module-boundary lint rule).
 */

import { api } from "@/lib/trpc/client";

interface A2pConsentPreviewProps {
  /** The in-progress legal name draft from the business form — previews live as it's typed. */
  legalName: string;
}

export function A2pConsentPreview({ legalName }: A2pConsentPreviewProps) {
  const trimmed = legalName.trim();
  const preview = api.v1.a2p.previewConsent.useQuery(
    { legalName: trimmed },
    { enabled: trimmed.length > 0, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (trimmed.length === 0) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
        Enter your business name above to preview the consent language your customers will see.
      </p>
    );
  }

  if (preview.isLoading) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
        Loading preview…
      </p>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <p style={{ color: "var(--red-700, #b42318)", fontSize: "var(--type-sm)", margin: 0 }} role="alert">
        Couldn&apos;t load the consent preview — check your connection and try again.
      </p>
    );
  }

  const { consentDescription, sampleMessages, optInMessage, smsTerms } = preview.data;

  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600 }}>
        Consent language (preview)
      </div>
      <p style={{ fontSize: "var(--type-sm)", margin: 0 }}>{consentDescription}</p>

      <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, marginTop: "var(--space-2)" }}>
        Sample messages
      </div>
      <ul style={{ margin: 0, paddingLeft: "var(--space-5)", display: "grid", gap: "var(--space-1)" }}>
        {sampleMessages.map((m) => (
          <li key={m} style={{ fontSize: "var(--type-sm)" }}>{m}</li>
        ))}
      </ul>

      <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, marginTop: "var(--space-2)" }}>
        Opt-in confirmation
      </div>
      <p style={{ fontSize: "var(--type-sm)", margin: 0 }}>{optInMessage}</p>

      <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, marginTop: "var(--space-2)" }}>
        SMS Terms clause (for your Terms page)
      </div>
      <p style={{ fontSize: "var(--type-sm)", margin: 0 }}>{smsTerms}</p>
    </div>
  );
}
