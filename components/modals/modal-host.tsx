/**
 * components/modals/modal-host.tsx
 * Reads activeModal from the store and renders the matching modal content.
 * Mounted once in (office)/layout.tsx — works app-wide.
 */

"use client";

import { useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { LeadModal } from "./lead-modal/lead-modal";
import { NewCustomerModal } from "./new-customer-modal";
import { SweepModalContent } from "./sweep-modal";
import { QuoteSweepModalContent } from "./quote-sweep-modal";
import { ThreadModalContent } from "./thread-modal";
import { CallModalContent } from "./call-modal";
import { EstimateModalContent } from "./estimate-modal";
import { JobModalContent } from "./job-modal";
import { NewJobModalContent } from "./new-job-modal";
import { JobSweepModalContent } from "./job-sweep-modal";
import { EvisitModalContent } from "./evisit-modal";
import { PriceBuilderModalContent } from "./price-builder-modal";
import { Modal } from "./modal";
import {
  VisitModalContent,
  ComposerModalContent,
  CleanUpModalContent,
} from "./placeholder-modals";

export function ModalHost() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const id = activeModal?.id;

  return (
    <>
      <LeadModal open={id === MODAL.LEAD} />
      <NewCustomerModal open={id === MODAL.NEW_CUSTOMER} />

      {/* Placeholder modals — full internals in later slices */}
      <Modal open={id === MODAL.CALL} onClose={close}>
        <CallModalContent />
      </Modal>

      <Modal open={id === MODAL.THREAD} onClose={close}>
        <ThreadModalContent />
      </Modal>

      <Modal open={id === MODAL.VISIT} onClose={close}>
        <VisitModalContent />
      </Modal>

      <Modal open={id === MODAL.COMPOSER} onClose={close} wide>
        <ComposerModalContent />
      </Modal>

      <Modal open={id === MODAL.CLEAN_UP} onClose={close}>
        <CleanUpModalContent />
      </Modal>

      <Modal open={id === MODAL.SWEEP} onClose={close}>
        <SweepModalContent />
      </Modal>

      <Modal open={id === MODAL.QUOTE_SWEEP} onClose={close}>
        <QuoteSweepModalContent />
      </Modal>

      <Modal open={id === MODAL.EST} onClose={close} wide>
        <EstimateModalContent />
      </Modal>

      <Modal open={id === MODAL.JOB} onClose={close} wide>
        <JobModalContent />
      </Modal>

      <Modal open={id === MODAL.NEW_JOB} onClose={close}>
        <NewJobModalContent />
      </Modal>

      <Modal open={id === MODAL.JOB_SWEEP} onClose={close}>
        <JobSweepModalContent />
      </Modal>

      <Modal open={id === MODAL.EVISIT} onClose={close}>
        <EvisitModalContent />
      </Modal>

      <Modal open={id === MODAL.PRICE_BUILDER} onClose={close} wide>
        <PriceBuilderModalContent />
      </Modal>
    </>
  );
}
