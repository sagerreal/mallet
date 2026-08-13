"use client";

/**
 * Settings → Workspace → Your account → "Your callback number".
 *
 * Per-USER, not per-org, which is why it sits in the "Your account" group beside Your name. The
 * form itself is shared with the technician's Account page — a technician places calls too and has
 * no Settings page, so this file is only the office shell around it.
 */

import { CallbackNumberForm, useCallbackNumberSummary } from "@/features/settings/callback-number-form";
import { FoldCard } from "./fold-card";
import { MarkPhone } from "./setting-marks";

export function CallbackNumberCard() {
  const summary = useCallbackNumberSummary();
  return (
    <FoldCard title="Your callback number" mark={<MarkPhone />} defaultOpen summary={summary}>
      <CallbackNumberForm />
    </FoldCard>
  );
}
