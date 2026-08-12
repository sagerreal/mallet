"use client";

/**
 * Import companies — the B2B accounts a shop bills, as distinct from the individual contacts
 * inside them. A property manager is one company with several site contacts; the contacts come in
 * through the customers importer.
 *
 * All parsing and validation happen in the browser; no file touches the server. Re-importing
 * UPDATES rather than duplicating, so an account list can be refreshed.
 *
 * The flow itself lives in ImportModal — this file supplies the descriptor, the wording, and how
 * to send a chunk.
 */

import { api } from "@/lib/trpc/client";
import { COMPANY_IMPORT } from "@/lib/import/engine/descriptors";
import type { BuiltRow } from "@/lib/import/engine/descriptor";
import { ImportModal, type ImportModalCopy } from "./import-modal";

/** The row shape v1.companies.importCompanies accepts, mirrored from its Zod input. */
interface CompanyImportRow {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
}

const COPY: ImportModalCopy = {
  title: "Import companies",
  uploadHint:
    "Bring in the businesses you bill — property managers, GCs, facilities teams. Their individual contacts come in through Customers.",
  skipReason: "no name",
  importLabel: (n) => `Import ${n} compan${n === 1 ? "y" : "ies"}`,
  doneHeadline: (created) => `${created} compan${created === 1 ? "y" : "ies"} added`,
  // An account that already exists is PATCHED, never skipped, so this never fires — the done card
  // reports "N updated" instead. Kept for the shared contract.
  dedupedLabel: (n) => `${n} already on file`,
};

export function ImportCompaniesModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.companies.importCompanies.useMutation();
  const existing = api.v1.companies.importNames.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const existingNames = new Set(existing.data?.names ?? []);

  return (
    <ImportModal
      descriptor={COMPANY_IMPORT}
      copy={COPY}
      isPending={importMut.isPending}
      sendChunk={(rows: BuiltRow[]) =>
        importMut.mutateAsync({ rows: rows as unknown as CompanyImportRow[] })
      }
      onChunkDone={async () => {
        await utils.v1.companies.list.invalidate();
        // Stale after a chunk — a second import in one session must count against what exists NOW.
        await utils.v1.companies.importNames.invalidate();
      }}
      // Same rule the server applies: exact name, case-insensitive.
      countUpdates={(rows) =>
        rows.filter((r) => existingNames.has(String(r.name ?? "").trim().toLowerCase())).length
      }
    />
  );
}
