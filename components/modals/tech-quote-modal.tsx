/**
 * components/modals/tech-quote-modal.tsx
 * The TECH_QUOTE modal — now a thin frame around the shared TechQuoteBuilder
 * (components/modals/pricing/tech-quote-builder.tsx), which owns the whole
 * edit → present → sign machine. Estimating part 3 gave the builder a second
 * home on the tech job view's Quote tab; this modal remains the office path
 * ("Price it on site →" in the shared job view's office mode). Close-on-sign:
 * the modal back-stack owns the return (closeModal pops back to the job view
 * that pushed this builder). The Modal shell renders the ✕.
 */

"use client";

import { useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { TechQuoteBuilder } from "./pricing/tech-quote-builder";

export function TechQuoteModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const jobId = activeModal?.params?.jobId as string | undefined;
  return <TechQuoteBuilder jobId={jobId} onSigned={close} />;
}
