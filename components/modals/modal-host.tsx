/**
 * components/modals/modal-host.tsx
 * Reads activeModal from the store and renders the matching modal content.
 * Mounted once in (office)/layout.tsx — works app-wide.
 */

"use client";

import { useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL, type ModalId } from "@/lib/store/modal-ids";
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
import { TechQuoteModalContent } from "./tech-quote-modal";
import { StandardsModalContent } from "./standards-modal";
import { InvoiceModalContent } from "./invoice-modal";
import { TechJobModalContent } from "./tech-job-modal";
import { CustQuoteModalContent } from "./cust-quote-modal";
import { CustInvoiceModalContent } from "./cust-invoice-modal";
import { CloseOutModalContent } from "./close-out-modal";
import { Modal } from "./modal";
import { VisitModalContent } from "./visit-modal";
import { CleanUpModalContent } from "./placeholder-modals";
import { CompanyViewModalContent } from "./company-view-modal";

export function ModalHost() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const id = activeModal?.id;

  // The price / tech-quote builders return to the job they were opened from on
  // ✕ / backdrop / Escape (prototype tqClose re-opens the job), never a dead end.
  const backToJob = (jobModalId: ModalId) => () => {
    const jobId = activeModal?.params?.jobId;
    if (typeof jobId === "number") openModal(jobModalId, { jobId });
    else close();
  };

  // Contact/booking sub-modals (Call / Text / Book-a-visit) return to the modal
  // they were opened from (params.returnTo) — never a dead-end blank list.
  const backToOpener = () => {
    const returnTo = activeModal?.params?.returnTo as ModalId | undefined;
    const leadId = activeModal?.params?.leadId;
    if (returnTo === MODAL.LEAD && typeof leadId === "number") {
      openModal(MODAL.LEAD, { leadId });
    } else {
      close();
    }
  };

  return (
    <>
      <LeadModal open={id === MODAL.LEAD} />
      <NewCustomerModal open={id === MODAL.NEW_CUSTOMER} />

      <Modal open={id === MODAL.CALL} onClose={backToOpener}>
        <CallModalContent />
      </Modal>

      <Modal open={id === MODAL.THREAD} onClose={backToOpener}>
        <ThreadModalContent />
      </Modal>

      <Modal open={id === MODAL.VISIT} onClose={backToOpener}>
        <VisitModalContent />
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

      {/* 560px — the prototype's tq sheet width; keeps the add-a-line tiles a 2×2 grid */}
      <Modal open={id === MODAL.PRICE_BUILDER} onClose={backToJob(MODAL.JOB)} maxWidth={560}>
        <PriceBuilderModalContent />
      </Modal>

      <Modal open={id === MODAL.TECH_QUOTE} onClose={backToJob(MODAL.TECH_JOB)} maxWidth={560}>
        <TechQuoteModalContent />
      </Modal>

      <Modal open={id === MODAL.STANDARDS} onClose={close} wide>
        <StandardsModalContent />
      </Modal>

      <Modal open={id === MODAL.INVOICE} onClose={close} wide>
        <InvoiceModalContent />
      </Modal>

      <Modal open={id === MODAL.TECH_JOB} onClose={close}>
        <TechJobModalContent />
      </Modal>

      <Modal open={id === MODAL.CUST_QUOTE} onClose={close}>
        <CustQuoteModalContent />
      </Modal>

      <Modal open={id === MODAL.CUST_INVOICE} onClose={close}>
        <CustInvoiceModalContent />
      </Modal>

      <Modal open={id === MODAL.CLOSE_OUT} onClose={close} wide>
        <CloseOutModalContent />
      </Modal>

      <Modal open={id === MODAL.COMPANY} onClose={close} wide>
        <CompanyViewModalContent />
      </Modal>
    </>
  );
}
