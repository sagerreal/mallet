"use client";

/**
 * Import jobs from a CSV exported by ANY system (Jobber, Housecall Pro, ServiceTitan, a
 * spreadsheet). All parsing and validation happen in the browser; no file touches the server.
 *
 * Unlike customers and services, a job row names its CUSTOMER rather than carrying an id — the
 * server resolves that per chunk (phone → name → create), so importing customers first is
 * advisory rather than required.
 *
 * The flow itself lives in ImportModal — this file supplies the descriptor, the wording, and how
 * to send a chunk.
 */

import { api } from "@/lib/trpc/client";
import { JOB_IMPORT } from "@/lib/import/engine/descriptors";
import type { BuiltRow } from "@/lib/import/engine/descriptor";
import { ImportModal, type ImportModalCopy } from "./import-modal";

/** The row shape v1.jobs.importJobs accepts, mirrored from its Zod input. */
interface JobImportRow {
  customer: string;
  phone: string | null;
  svc: string | null;
  scope: string | null;
  addr: string | null;
  status: string | null;
  scheduledDate: string | null;
  scheduledStart: string | null;
}

const COPY: ImportModalCopy = {
  title: "Import jobs",
  uploadHint:
    "Bring in your jobs from Jobber, Housecall Pro, ServiceTitan, or a spreadsheet — export a CSV and drop it here. Rows with a date land on the schedule; rows without one import unscheduled.",
  skipReason: "no customer",
  importLabel: (n) => `Import ${n} job${n === 1 ? "" : "s"}`,
  doneHeadline: (created) => `${created} job${created === 1 ? "" : "s"} added`,
  // Jobs have no natural key, so nothing is ever matched to an existing job. Present for the
  // shared contract; the server always reports zero.
  dedupedLabel: (n) => `${n} already on file`,
};

export function ImportJobsModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.jobs.importJobs.useMutation();

  return (
    <ImportModal
      descriptor={JOB_IMPORT}
      copy={COPY}
      isPending={importMut.isPending}
      sendChunk={(rows: BuiltRow[]) =>
        importMut.mutateAsync({ rows: rows as unknown as JobImportRow[] })
      }
      onChunkDone={async () => {
        // Jobs import can create customers, so both surfaces are stale after a chunk.
        await Promise.all([utils.v1.jobs.invalidate(), utils.v1.customers.invalidate()]);
      }}
    />
  );
}
