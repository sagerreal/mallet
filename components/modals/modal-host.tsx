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
import { Modal } from "./modal";
import {
  CallModalContent,
  ThreadModalContent,
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
    </>
  );
}
