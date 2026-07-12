# Import Customers (CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three dead "Import customers" buttons (QuickBooks / Google Contacts / Upload a spreadsheet) with ONE source-agnostic CSV importer: upload → map columns → preview/validate → bulk-create with dedupe → summary.

**Architecture:** All parsing, column-mapping, and validation happen **client-side** in a modal (no file ever reaches the server — the server receives clean JSON rows only). A new `v1.customers.importCustomers` procedure loops the *existing, tested* `EnsureCustomerUseCase` (which already creates + dedupes by phone) inside the org transaction and returns a per-batch summary. The heavy "foreign CRM data" logic (auto-map headers, combine first/last name, normalize phones, classify dirty rows) lives in two pure, unit-tested utils.

**Tech Stack:** Next.js 16, tRPC v11, Zod, Drizzle, Zustand, Vitest, `papaparse` (new dep — robust CSV parsing).

## Global Constraints

- Working directory: `/Users/owensmacbook/Downloads/prospecting/mallet-app-import-customers` (branch `feat/import-customers`, off `origin/main`).
- **CONTENTION:** the "Import customers" card lives in `SecSources` in `app/(office)/settings/page.tsx` — the SAME function another agent is editing for the "Source list". Keep the only shared-file edit (Task 6) surgical and LAST. If that PR has landed, rebase; if not, expect a small manual merge in that one card block.
- One new dependency only: `papaparse` + `@types/papaparse` (client-side CSV parsing). No other new deps.
- Tenant safety: org id ALWAYS from `ctx.principal.orgId`; the procedure is `ownerOrOffice` and runs in `withTenant`. NO new table/migration (the `leads`/customers table already holds every field).
- **Partial-success rule:** the client sends only rows that already passed validation, so the strict Zod input never rejects a batch. The server never `throw`s per row — `EnsureCustomerUseCase.exec` returns a `Result`; an `err` increments `failed` and is reported, it does not abort the org tx.
- Dedupe is by phone (existing `ON CONFLICT DO NOTHING` in `ensureCustomer`). Rows without a valid phone cannot dedupe — re-importing them creates duplicates. This is a documented v1 limitation.
- Money/immutability/DTO≠domain/validate-at-boundary house rules apply. Functions < 50 lines, files < 800.
- Batch cap: 500 rows per `importCustomers` call (matches the existing 500-row pilot ceiling). The client chunks larger files into sequential 500-row calls and aggregates.

## Reused surfaces (verified, do not re-implement)

- `Phone.parse(raw): Result<Phone, ValidationError>` in `shared/types/ids.ts` — strips all non-digits, accepts 10 digits or 11 with leading `1`, returns `+1XXXXXXXXXX`, else `err`. Handles `(925) 555-0100`, `925.555.0100`, `+1 925 555 0100`. Import from `@mallet/shared/types`.
- `EnsureCustomerUseCase(repo, bus, clock).exec(cmd): Promise<Result<{lead, created}, ...>>` in `modules/customers/app/ensure-customer.ts`. `EnsureCustomerCommand = { name, phone: Phone|null, email, source, companyId, role, notes, address }`.
- `DrizzleLeadRepository(ctx.tx, ctx.principal.orgId)` — org-scoped repo.
- Router: `createLeadRouter()` in `modules/customers/api/lead-router.ts`, registered as `v1.customers` in `trpc/root.ts`. Existing `create` mutation (lines ~206-236) is the pattern to mirror.
- `isOk`, `asCompanyId`, `Phone`, `logger` import paths: see the top of `lead-router.ts`.
- Modal system: `MODAL` ids in `lib/store/modal-ids.ts`; `components/modals/modal-host.tsx` maps `id` → component; open via `useOpenModal()(MODAL.X)`; the reusable `<Modal open onClose>{content}</Modal>` wrapper is `components/modals/modal.tsx`.
- Store refresh: `LeadsHydrator` subscribes to `trpc.v1.customers.list`; call `api.useUtils().v1.customers.list.invalidate()` after import to re-sync the store.

## File Structure

**Create:**
- `lib/import/parse-csv.ts` — `parseCsv(file): Promise<ParsedCsv>` (papaparse wrapper).
- `lib/import/parse-csv.test.ts`
- `lib/import/map-rows.ts` — `autoMap(headers)`, `buildImportRows(records, map)` + the shared `ImportRow`/`MappingConfig`/`BuildResult` types. The "foreign CRM" logic.
- `lib/import/map-rows.test.ts`
- `components/modals/import-customers-modal.tsx` — `ImportCustomersModalContent` (upload → map → preview → import → summary).
- `components/modals/import-customers-modal.test.tsx`
- `modules/customers/api/import-customers.int.test.ts` — integration test for the new procedure.

**Modify:**
- `package.json` — add `papaparse` + `@types/papaparse`.
- `modules/customers/api/lead-router.ts` — add `importCustomers` procedure + its Zod schemas + `importResultDTO`.
- `lib/store/modal-ids.ts` — add `IMPORT_CUSTOMERS: "import-customers"`.
- `components/modals/modal-host.tsx` — import + render the new modal.
- `app/(office)/settings/page.tsx` — SecSources "Import customers" card: 3 buttons → 1 "Upload a spreadsheet (CSV)" button (+ export hint). **Surgical, last.**

---

## Task 1: `v1.customers.importCustomers` procedure

**Files:**
- Modify: `modules/customers/api/lead-router.ts`
- Test: `modules/customers/api/import-customers.int.test.ts`

**Interfaces:**
- Produces: `v1.customers.importCustomers({ rows: ImportRowInput[] }) → { created, deduped, failed, errors: {index,message}[] }`. `ImportRowInput = { name: string(1..255), phone: string(≤40)|null, email: string.email(≤320)|null, source: string(≤255)|null, address: string(≤500)|null, notes: string(≤2000)|null }`.

- [ ] **Step 1: Write the failing integration test**

Create `modules/customers/api/import-customers.int.test.ts`. Mirror the setup of the existing customer int tests (copy the ctx/org bootstrap from `modules/customers/api/*.int.test.ts` — same `admin` fixture + `appRouter.createCaller(ctx)` pattern; if unsure, open an existing customers int test and copy its header verbatim).

```typescript
import { describe, it, expect } from "vitest";
// ... copy the exact imports + ctxFor/org-bootstrap helpers used by the sibling
//     customers int tests (createCaller, a provisioned owner principal, admin sql) ...

describe("v1.customers.importCustomers", () => {
  it("creates new customers, dedupes by phone, and reports per-row errors", async () => {
    const caller = /* ownerOrOffice caller for a fresh test org (copy sibling setup) */;

    const res = await caller.v1.customers.importCustomers({
      rows: [
        { name: "Gary Pratt", phone: "(925) 555-0100", email: "gary@x.com", source: "Import", address: "1 Pine Rd", notes: null },
        { name: "Gary Again",  phone: "925.555.0100",  email: null, source: "Import", address: null, notes: null }, // same phone → dedupe
        { name: "No Phone Person", phone: null, email: null, source: "Import", address: null, notes: null },
      ],
    });

    expect(res.created).toBe(2);   // Gary Pratt + No Phone Person
    expect(res.deduped).toBe(1);   // Gary Again (phone collision)
    expect(res.failed).toBe(0);
  });

  it("rejects a batch over the 500-row cap", async () => {
    const caller = /* same */;
    const rows = Array.from({ length: 501 }, (_, i) => ({
      name: `C${i}`, phone: null, email: null, source: null, address: null, notes: null,
    }));
    await expect(caller.v1.customers.importCustomers({ rows })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run modules/customers/api/import-customers.int.test.ts 2>&1 | tail -20`
Expected: FAIL — `importCustomers` is not a function on the router. (Requires `.env.local` DB creds; this is an int test against the live shared DB — same as sibling customer int tests.)

- [ ] **Step 3: Add the schemas + procedure**

In `modules/customers/api/lead-router.ts`, after `createInput` (line ~47) add:

```typescript
const importRowInput = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(40).nullable(),   // raw string; server parses leniently, never rejects the batch
  email: z.string().email().max(320).nullable(),
  source: z.string().max(255).nullable(),
  address: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
});
const importInput = z.object({ rows: z.array(importRowInput).min(1).max(500) });

const importResultDTO = z.object({
  created: z.number().int(),
  deduped: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
});
```

Inside `createLeadRouter()`'s `router({ ... })`, add a procedure (place it right after `create`):

```typescript
    importCustomers: ownerOrOffice
      .input(importInput)
      .output(importResultDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new EnsureCustomerUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        let created = 0;
        let deduped = 0;
        let failed = 0;
        const errors: { index: number; message: string }[] = [];

        for (let i = 0; i < input.rows.length; i++) {
          const r = input.rows[i]!;
          // Lenient phone parse: an unreadable phone is dropped, not fatal (name is the only requirement).
          let phone = null as import("@mallet/shared/types").Phone | null;
          if (r.phone) {
            const parsed = Phone.parse(r.phone);
            if (isOk(parsed)) phone = parsed.value;
          }
          // exec returns a Result — NEVER throws for validation, so one bad row can't roll back the tx.
          const result = await useCase.exec({
            name: r.name,
            phone,
            email: r.email,
            source: r.source,
            companyId: null,
            role: null,
            notes: r.notes?.trim() || null,
            address: r.address?.trim() || null,
          });
          if (isOk(result)) {
            result.value.created ? (created += 1) : (deduped += 1);
          } else {
            failed += 1;
            errors.push({ index: i, message: result.error.message });
          }
        }

        logger.info({ orgId: ctx.principal.orgId, created, deduped, failed }, "customers.imported");
        return { created, deduped, failed, errors };
      }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run modules/customers/api/import-customers.int.test.ts 2>&1 | tail -20`
Expected: PASS (2/2). If the sibling-setup copy is off, fix the ctx bootstrap only.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | tail -5` → 0 errors.
```bash
git add modules/customers/api/lead-router.ts modules/customers/api/import-customers.int.test.ts
git commit -m "feat(customers): v1.customers.importCustomers — bulk create with dedupe + per-row result"
```

---

## Task 2: CSV parse util (`papaparse`)

**Files:**
- Modify: `package.json`
- Create: `lib/import/parse-csv.ts`, `lib/import/parse-csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(file: File): Promise<ParsedCsv>` where `ParsedCsv = { headers: string[]; records: Record<string, string>[] }`. Header row is required; values are trimmed strings; fully-empty rows are dropped.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add papaparse && pnpm add -D @types/papaparse`
Expected: `package.json` gains both; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `lib/import/parse-csv.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseCsv } from "./parse-csv";

function fileOf(text: string): File {
  return new File([text], "customers.csv", { type: "text/csv" });
}

describe("parseCsv", () => {
  it("parses headers + records, trims, and handles quoted commas", async () => {
    const csv = `First Name,Phone,Address\nGary,(925) 555-0100,"1 Pine Rd, Apt 2"\n`;
    const out = await parseCsv(fileOf(csv));
    expect(out.headers).toEqual(["First Name", "Phone", "Address"]);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toEqual({ "First Name": "Gary", Phone: "(925) 555-0100", Address: "1 Pine Rd, Apt 2" });
  });

  it("drops fully-empty rows", async () => {
    const out = await parseCsv(fileOf(`Name\nGary\n\n,\n`));
    expect(out.records).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/import/parse-csv.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/import/parse-csv.ts`:

```typescript
import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  records: Record<string, string>[];
}

/**
 * Parse a user-uploaded CSV entirely in the browser. papaparse auto-detects the
 * delimiter (comma/semicolon/tab — European exports use `;`), handles quoted
 * fields with embedded commas/newlines, and strips a UTF-8 BOM. The first row is
 * the header. Values are coerced to trimmed strings; rows where every cell is
 * blank are dropped. Rejects if the file has no header row.
 */
export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      transform: (v) => v.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
        if (headers.length === 0) {
          reject(new Error("This file has no header row. Add a header row (e.g. Name, Phone, Email) and try again."));
          return;
        }
        const records = result.data.filter((r) => Object.values(r).some((v) => (v ?? "").length > 0));
        resolve({ headers, records });
      },
      error: (err) => reject(new Error(`Could not read the file: ${err.message}`)),
    });
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/import/parse-csv.test.ts 2>&1 | tail -10`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/import/parse-csv.ts lib/import/parse-csv.test.ts
git commit -m "feat(import): client-side CSV parse util (papaparse)"
```

---

## Task 3: Column-map + row-build util (the foreign-CRM logic)

**Files:**
- Create: `lib/import/map-rows.ts`, `lib/import/map-rows.test.ts`

**Interfaces:**
- Produces:
  - `ImportRow = { name: string; phone: string | null; email: string | null; address: string | null; source: string | null; notes: string | null }`
  - `MappingConfig = { name: string | null; lastName: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; sourceTag: string }` (values are header keys; `sourceTag` is a constant applied to every row)
  - `RowIssue = { rowIndex: number; kind: "skipped" | "warning"; message: string }`
  - `BuildResult = { rows: ImportRow[]; skipped: RowIssue[]; warnings: RowIssue[] }`
  - `autoMap(headers: string[]): MappingConfig`
  - `buildImportRows(records: Record<string,string>[], map: MappingConfig): BuildResult`

- [ ] **Step 1: Write the failing test**

Create `lib/import/map-rows.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { autoMap, buildImportRows } from "./map-rows";

describe("autoMap", () => {
  it("guesses common QuickBooks/Google headers, incl. split first/last name", () => {
    const m = autoMap(["First Name", "Last Name", "Phone", "Email Address", "Billing Address"]);
    expect(m.name).toBe("First Name");
    expect(m.lastName).toBe("Last Name");
    expect(m.phone).toBe("Phone");
    expect(m.email).toBe("Email Address");
    expect(m.address).toBe("Billing Address");
  });

  it("uses a single 'Customer' column as the name when there is no first/last", () => {
    const m = autoMap(["Customer", "Mobile", "E-mail"]);
    expect(m.name).toBe("Customer");
    expect(m.lastName).toBeNull();
    expect(m.phone).toBe("Mobile");
    expect(m.email).toBe("E-mail");
  });
});

describe("buildImportRows", () => {
  const map = { name: "First Name", lastName: "Last Name", phone: "Phone", email: "Email", address: "Address", notes: null, sourceTag: "Import" };

  it("combines first+last, tags source, keeps valid rows", () => {
    const out = buildImportRows(
      [{ "First Name": "Gary", "Last Name": "Pratt", Phone: "(925) 555-0100", Email: "g@x.com", Address: "1 Pine" }],
      map,
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({ name: "Gary Pratt", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", source: "Import", notes: null });
    expect(out.skipped).toHaveLength(0);
  });

  it("skips rows with no name", () => {
    const out = buildImportRows([{ "First Name": "", "Last Name": "" }], map);
    expect(out.rows).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.message).toMatch(/name/i);
  });

  it("warns and nulls an unreadable phone (row still imports)", () => {
    const out = buildImportRows([{ "First Name": "Ann", Phone: "call me maybe" }], map);
    expect(out.rows[0]!.phone).toBeNull();
    expect(out.warnings.some((w) => /phone/i.test(w.message))).toBe(true);
  });

  it("warns and nulls a malformed email (row still imports)", () => {
    const out = buildImportRows([{ "First Name": "Ann", Email: "not-an-email" }], map);
    expect(out.rows[0]!.email).toBeNull();
    expect(out.warnings.some((w) => /email/i.test(w.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/import/map-rows.test.ts 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/import/map-rows.ts`:

```typescript
/**
 * Turns a parsed foreign-CRM CSV into clean Mallet customer rows.
 * `autoMap` best-guesses which columns map to which Mallet field (handling
 * split First/Last name); `buildImportRows` applies a mapping, classifying each
 * source row as ready / skipped (no name) / warning (unreadable phone or email —
 * the field is dropped but the row still imports, since name is the only
 * requirement). Phone validity mirrors Phone.parse in shared/types/ids.ts.
 */

export interface ImportRow {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  notes: string | null;
}

export interface MappingConfig {
  name: string | null;      // header for the full or first name
  lastName: string | null;  // optional header appended to name
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  sourceTag: string;        // constant tag applied to every imported row
}

export interface RowIssue {
  rowIndex: number;
  kind: "skipped" | "warning";
  message: string;
}

export interface BuildResult {
  rows: ImportRow[];
  skipped: RowIssue[];
  warnings: RowIssue[];
}

// Header synonyms → Mallet field. Matched case-insensitively by substring.
const SYNONYMS: Record<keyof Omit<MappingConfig, "sourceTag" | "lastName">, string[]> = {
  name: ["first name", "full name", "customer name", "customer", "contact", "name", "display name"],
  phone: ["mobile", "cell", "phone", "telephone", "primary phone"],
  email: ["email address", "e-mail", "email"],
  address: ["billing address", "service address", "street", "address"],
  notes: ["notes", "note", "description", "memo"],
};

function findHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

export function autoMap(headers: string[]): MappingConfig {
  const last = findHeader(headers, ["last name", "surname", "family name"]);
  return {
    name: findHeader(headers, SYNONYMS.name),
    lastName: last,
    phone: findHeader(headers, SYNONYMS.phone),
    email: findHeader(headers, SYNONYMS.email),
    address: findHeader(headers, SYNONYMS.address),
    notes: findHeader(headers, SYNONYMS.notes),
    sourceTag: "Import",
  };
}

// Mirrors Phone.parse (shared/types/ids.ts): 10 US digits, or 11 with leading 1.
function phoneLooksValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cell(record: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (record[header] ?? "").trim();
}

export function buildImportRows(records: Record<string, string>[], map: MappingConfig): BuildResult {
  const rows: ImportRow[] = [];
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  records.forEach((record, rowIndex) => {
    const first = cell(record, map.name);
    const last = cell(record, map.lastName);
    const name = [first, last].filter(Boolean).join(" ").trim();
    if (!name) {
      skipped.push({ rowIndex, kind: "skipped", message: "No name — row skipped." });
      return;
    }

    const rawPhone = cell(record, map.phone);
    let phone: string | null = null;
    if (rawPhone) {
      if (phoneLooksValid(rawPhone)) phone = rawPhone;
      else warnings.push({ rowIndex, kind: "warning", message: `Couldn't read phone "${rawPhone}" — imported without it.` });
    }

    const rawEmail = cell(record, map.email);
    let email: string | null = null;
    if (rawEmail) {
      if (EMAIL_RE.test(rawEmail)) email = rawEmail;
      else warnings.push({ rowIndex, kind: "warning", message: `Couldn't read email "${rawEmail}" — imported without it.` });
    }

    rows.push({
      name: name.slice(0, 255),
      phone,
      email,
      address: cell(record, map.address).slice(0, 500) || null,
      source: map.sourceTag.trim() || null,
      notes: cell(record, map.notes).slice(0, 2000) || null,
    });
  });

  return { rows, skipped, warnings };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/import/map-rows.test.ts 2>&1 | tail -10`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/import/map-rows.ts lib/import/map-rows.test.ts
git commit -m "feat(import): column auto-map + row-build with dirty-data classification"
```

---

## Task 4: Import modal (upload → map → preview → import → summary)

**Files:**
- Create: `components/modals/import-customers-modal.tsx`, `components/modals/import-customers-modal.test.tsx`

**Interfaces:**
- Consumes: `parseCsv`, `autoMap`, `buildImportRows` (+ types), `api` (`useUtils` + `v1.customers.importCustomers.useMutation`).
- Produces: `export function ImportCustomersModalContent()` — a self-contained modal body with a 4-phase local state machine (`upload | map | importing | done`).

- [ ] **Step 1: Write the failing test (mapping preview render)**

Create `components/modals/import-customers-modal.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportCustomersModalContent } from "./import-customers-modal";

const mutateAsync = vi.fn().mockResolvedValue({ created: 1, deduped: 0, failed: 0, errors: [] });
const invalidate = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate: invalidate } } } }),
    v1: { customers: { importCustomers: { useMutation: () => ({ mutateAsync, isPending: false }) } } },
  },
}));

function selectCsv(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "c.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportCustomersModalContent", () => {
  it("parses an upload, shows a preview count, imports, and shows a summary", async () => {
    render(<ImportCustomersModalContent />);
    selectCsv(`First Name,Phone\nGary,(925) 555-0100\n`);

    // moves to the map/preview phase and reports 1 ready row
    await waitFor(() => expect(screen.getByText(/1 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 1 customer/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/1 added/i)).toBeTruthy());
    expect(invalidate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/modals/import-customers-modal.test.tsx 2>&1 | tail -15`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal**

Create `components/modals/import-customers-modal.tsx`. Structure (write it in full; keep helpers < 50 lines, file < 400):

```tsx
"use client";

/**
 * Import customers from a CSV exported by ANY system (QuickBooks, Google Contacts,
 * Jobber, a spreadsheet). Parses + maps + validates entirely in the browser and
 * sends clean rows to v1.customers.importCustomers in ≤500-row chunks. Dedupe by
 * phone is handled server-side. No file touches the server.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { parseCsv } from "@/lib/import/parse-csv";
import { autoMap, buildImportRows, type MappingConfig, type BuildResult } from "@/lib/import/map-rows";

const CHUNK = 500;
const TARGETS: { key: keyof Omit<MappingConfig, "sourceTag">; label: string }[] = [
  { key: "name", label: "Name (or first name)" },
  { key: "lastName", label: "Last name (optional)" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" },
];

type Phase = "upload" | "map" | "importing" | "done";
interface Summary { created: number; deduped: number; failed: number; }

export function ImportCustomersModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.customers.importCustomers.useMutation();

  const [phase, setPhase] = useState<Phase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<MappingConfig | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const { headers: h, records: r } = await parseCsv(file);
      setHeaders(h);
      setRecords(r);
      setMap(autoMap(h));
      setPhase("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file.");
    }
  }

  const built: BuildResult | null = map ? buildImportRows(records, map) : null;

  async function runImport() {
    if (!built) return;
    setPhase("importing");
    let created = 0, deduped = 0, failed = 0;
    try {
      for (let i = 0; i < built.rows.length; i += CHUNK) {
        const res = await importMut.mutateAsync({ rows: built.rows.slice(i, i + CHUNK) });
        created += res.created; deduped += res.deduped; failed += res.failed;
      }
      await utils.v1.customers.list.invalidate();
      setSummary({ created, deduped, failed });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed. Nothing was changed for the failed batch.");
      setPhase("map");
    }
  }

  function setField(key: keyof Omit<MappingConfig, "sourceTag">, value: string) {
    setMap((m) => (m ? { ...m, [key]: value || null } : m));
  }

  return (
    <div className="import-modal" style={{ minWidth: 380, maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Import customers</h2>

      {phase === "upload" && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Upload a CSV from anywhere — QuickBooks, Google Contacts, Jobber, or a spreadsheet.
            Export a CSV from that tool and drop it here.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          {error && <p className="auth-error" style={{ marginTop: 12 }}>{error}</p>}
        </>
      )}

      {phase === "map" && map && built && (
        <>
          <p className="muted" style={{ fontSize: 13 }}>Match your columns to Mallet fields:</p>
          <div style={{ display: "grid", gap: 8 }}>
            {TARGETS.map((t) => (
              <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 150, fontSize: 13 }}>{t.label}</span>
                <select value={map[t.key] ?? ""} onChange={(e) => setField(t.key, e.target.value)}
                  style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 13 }}>
                  <option value="">— none —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 150, fontSize: 13 }}>Tag source as</span>
              <input value={map.sourceTag} onChange={(e) => setMap((m) => m ? { ...m, sourceTag: e.target.value } : m)}
                style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 13 }} />
            </label>
          </div>

          <div className="muted" style={{ fontSize: 13, margin: "14px 0" }}>
            <b>{built.rows.length} ready</b>
            {built.skipped.length > 0 && ` · ${built.skipped.length} skipped (no name)`}
            {built.warnings.length > 0 && ` · ${built.warnings.length} warnings`}
          </div>

          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary" disabled={built.rows.length === 0} onClick={runImport}>
            Import {built.rows.length} customer{built.rows.length === 1 ? "" : "s"}
          </button>
        </>
      )}

      {phase === "importing" && <p className="muted">Importing…</p>}

      {phase === "done" && summary && (
        <>
          <p style={{ fontWeight: 700 }}>Done.</p>
          <p className="muted" style={{ fontSize: 13 }}>
            {summary.created} added
            {summary.deduped > 0 && ` · ${summary.deduped} already existed`}
            {summary.failed > 0 && ` · ${summary.failed} failed`}.
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/modals/import-customers-modal.test.tsx 2>&1 | tail -15`
Expected: PASS. If the mocked `api` shape mismatches the real `@/lib/trpc/client`, adjust the mock to match the real export (open `lib/trpc/client.ts` and mirror its `api` shape).

- [ ] **Step 5: Commit**

```bash
git add components/modals/import-customers-modal.tsx components/modals/import-customers-modal.test.tsx
git commit -m "feat(import): CSV import modal — upload, column map, preview, chunked import, summary"
```

---

## Task 5: Register the modal

**Files:**
- Modify: `lib/store/modal-ids.ts`, `components/modals/modal-host.tsx`

**Interfaces:**
- Produces: `MODAL.IMPORT_CUSTOMERS = "import-customers"`, rendered by ModalHost.

- [ ] **Step 1: Add the modal id**

In `lib/store/modal-ids.ts`, inside the `MODAL` object, add:
```typescript
  IMPORT_CUSTOMERS: "import-customers",
```

- [ ] **Step 2: Register in ModalHost**

In `components/modals/modal-host.tsx`, add the import near the other modal imports:
```typescript
import { ImportCustomersModalContent } from "./import-customers-modal";
```
And add the render near the other `<Modal open=...>` entries (use `close` — the standalone close handler used by SWEEP etc.):
```tsx
      <Modal open={id === MODAL.IMPORT_CUSTOMERS} onClose={close}>
        <ImportCustomersModalContent />
      </Modal>
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | tail -5` → 0 errors.
```bash
git add lib/store/modal-ids.ts components/modals/modal-host.tsx
git commit -m "feat(import): register the Import customers modal"
```

---

## Task 6: Swap the settings card (SURGICAL — shared file)

**Files:**
- Modify: `app/(office)/settings/page.tsx` (the "Import customers" `FoldCard` in `SecSources`)

**Interfaces:**
- Consumes: `MODAL.IMPORT_CUSTOMERS`, `useOpenModal` (already imported in this file).

- [ ] **Step 1: Replace the three dead buttons**

Find the block (in `SecSources`):
```tsx
      <FoldCard title="Import customers" summary="QuickBooks · CSV">
        <div ...>
          <button className="btn" onClick={() => {}}>Import from QuickBooks</button>
          <button className="btn" onClick={() => {}}>Google Contacts</button>
          <button className="btn ghost" onClick={() => {}}>Upload a spreadsheet</button>
        </div>
      </FoldCard>
```
Replace with (get `openModal` from `useOpenModal()` at the top of `SecSources` if not already present — check first; `MODAL` is already imported in this file):
```tsx
      <FoldCard title="Import customers" summary="CSV">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Coming from QuickBooks, Google Contacts, or another tool? Export a CSV and upload it here.
        </p>
        <button className="btn primary" onClick={() => openModal(MODAL.IMPORT_CUSTOMERS)}>
          Upload a spreadsheet (CSV)
        </button>
      </FoldCard>
```

- [ ] **Step 2: Verify `openModal` is available in SecSources**

If `SecSources` does not already call `useOpenModal()`, add at the top of the function:
```typescript
  const openModal = useOpenModal();
```
Run: `npx tsc --noEmit 2>&1 | tail -5` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(office)/settings/page.tsx"
git commit -m "feat(import): replace dead import buttons with the CSV importer"
```

---

## Task 7: Full gate, screenshot, PR

- [ ] **Step 1: Full gate**

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run lint 2>&1 | tail -5          # 0 errors (warnings are legacy)
npm test 2>&1 | tail -8              # all unit pass
npm run coverage 2>&1 | tail -8      # ≥ 80% stmts / 75% branches
npm run build 2>&1 | tail -5         # ok
```

- [ ] **Step 2: Integration run (live DB)**

```bash
npm run test:int -- import-customers 2>&1 | tail -15
```
Expected: the Task 1 int test passes against the live shared DB. (Note: shared with other sessions — additive test data only.)

- [ ] **Step 3: Screenshot the flow (Playwright, dedicated port)**

Boot a dev server on a dedicated port (`PORT=3210 pnpm dev`), then drive: log in as `owner@e2e.mallet.test` / `e2e-password-1`, Settings → Lead sources → "Upload a spreadsheet (CSV)", upload a small fixture CSV, screenshot the map/preview and the summary. Delete the throwaway spec and `git checkout -- next-env.d.ts` before committing. (See the `mallet-worktree-dev-screenshot` memory for the exact loop.)

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/import-customers
gh pr create --base main --title "feat(import): source-agnostic CSV customer import" --body "<summary + verification table + the SecSources contention note>"
```
Note in the PR body: single new dep `papaparse`; the `SecSources` overlap with the concurrent Source-list work; the v1 limitations (dedupe only for rows with a phone; address is a single mapped column, split city/state/zip not auto-joined).

---

## Self-Review

### Spec coverage
| Requirement | Task |
|---|---|
| One source-agnostic CSV importer (not QB/Google-specific) | 4 + 6 |
| Bulk create reusing existing dedupe | 1 |
| Column mapping incl. split first/last name | 3 |
| Dirty-data classification (skip no-name, warn bad phone/email) | 3 |
| Robust parsing (quoted commas, delimiter, BOM) | 2 |
| Preview counts before writing | 4 |
| Partial-success / per-row errors, no tx-abort on one bad row | 1 (Result, no throw) + 4 (client pre-validates) |
| ≤500/call chunking | 1 (cap) + 4 (chunk loop) |
| Store refresh after import | 4 (invalidate) |
| Replace dead buttons + export hint | 6 |
| No new table/migration | (whole plan) |

### Placeholder scan
Only intentional copy-from-sibling is the int-test ctx bootstrap (Task 1 Step 1) and the "PR body" text (Task 7) — both call out exactly what to copy. No TBD/TODO logic steps.

### Type consistency
`ImportRow` / `MappingConfig` / `BuildResult` defined in Task 3 and consumed unchanged in Task 4. `importCustomers` input `{rows: ImportRowInput[]}` (Task 1) matches the client payload `{ rows: built.rows.slice(...) }` (Task 4) — `ImportRow` fields (name/phone/email/address/source/notes) are exactly `importRowInput`'s keys. `{created,deduped,failed,errors}` result shape identical in Task 1 output and Task 4 aggregation.

### Notes / v1 limitations (documented, intentional)
- Dedupe is phone-only; phoneless rows can duplicate on re-import.
- Address maps from one column; split street/city/state/zip is not auto-joined (user pre-combines, or a follow-up adds multi-part join).
- All imported rows are people (companyId/role null); company records aren't created from import in v1.
