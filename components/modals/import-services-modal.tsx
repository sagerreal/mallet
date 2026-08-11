"use client";

/**
 * Import price book services from a CSV exported by ANY system (Housecall Pro, Jobber,
 * ServiceTitan, a spreadsheet). Money strings become integer cents and category names are resolved
 * server-side per row. All parsing and validation happen in the browser; no file touches the
 * server.
 *
 * The flow itself lives in ImportModal — this file supplies the descriptor, the wording, and how
 * to send a chunk.
 */

import { api } from "@/lib/trpc/client";
import { SERVICE_IMPORT } from "@/lib/import/engine/descriptors";
import type { BuiltRow } from "@/lib/import/engine/descriptor";
import { ImportModal, type ImportModalCopy } from "./import-modal";

/** The row shape v1.pricebook.importServices accepts, mirrored from its Zod input. */
interface ServiceImportRow {
  name: string;
  category: string | null;
  description: string | null;
  code: string | null;
  unitPriceCents: number;
  costCents: number;
  taxable: boolean;
}

const COPY: ImportModalCopy = {
  title: "Import price book",
  uploadHint:
    "Bring in your price book from Housecall Pro, Jobber, ServiceTitan, or a spreadsheet — export a CSV and drop it here.",
  skipReason: "no name",
  importLabel: (n) => `Import ${n} service${n === 1 ? "" : "s"}`,
  doneHeadline: (created) => `${created} service${created === 1 ? "" : "s"} added`,
  dedupedLabel: (n) => `${n} already in your book`,
};

export function ImportServicesModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.pricebook.importServices.useMutation();

  return (
    <ImportModal
      descriptor={SERVICE_IMPORT}
      copy={COPY}
      isPending={importMut.isPending}
      sendChunk={(rows: BuiltRow[]) =>
        importMut.mutateAsync({ rows: rows as unknown as ServiceImportRow[] })
      }
      onChunkDone={() => utils.v1.pricebook.service.list.invalidate()}
    />
  );
}
