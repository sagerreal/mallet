/**
 * Turns a parsed foreign-CRM CSV into clean Mallet pricebook service rows.
 * Mirrors `map-rows.ts` (the customer import): `autoMapService` best-guesses
 * which columns map to which Elas field; `buildServiceImportRows` applies a
 * mapping, classifying each source row as ready / skipped (no name) / warning
 * (unreadable price or cost — imported at $0, flagged so the user can fix it
 * before or after committing).
 */
import type { RowIssue } from "./map-rows";
import { parseMoneyCents } from "./parse-money";

export interface ServiceImportRow {
  name: string;
  category: string | null;
  description: string | null;
  code: string | null;
  unitPriceCents: number;
  costCents: number;
  taxable: boolean;
}

export interface ServiceMappingConfig {
  name: string | null;
  category: string | null;
  description: string | null;
  code: string | null;
  price: string | null;
  cost: string | null;
  taxable: string | null;
}

export interface ServiceBuildResult {
  rows: ServiceImportRow[];
  skipped: RowIssue[];
  warnings: RowIssue[];
}

// Header synonyms → Elas field. Matched case-insensitively by substring.
const SYNONYMS: Record<keyof ServiceMappingConfig, string[]> = {
  name: ["service name", "service", "item name", "item", "task", "name"],
  category: ["category", "service category", "type", "group"],
  code: ["code", "sku", "item code"],
  price: ["customer price", "sell price", "price", "rate", "amount"],
  cost: ["material cost", "our cost", "cost"],
  description: ["description", "details", "work description"],
  taxable: ["taxable", "tax"],
};

function findHeader(headers: string[], candidates: string[], claimed: Set<string>): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h, i) => !claimed.has(headers[i]!) && h.includes(cand));
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

export function autoMapService(headers: string[]): ServiceMappingConfig {
  const claimed = new Set<string>();
  const claim = (h: string | null): string | null => {
    if (h) claimed.add(h);
    return h;
  };
  // Collision-prone specific fields claim their header first, so a generic later field
  // (name, description) never grabs a header a specific field also matches — e.g. "Item
  // code" is claimed by code before "item" grabs it for name.
  const code = claim(findHeader(headers, SYNONYMS.code, claimed));
  const price = claim(findHeader(headers, SYNONYMS.price, claimed));
  const cost = claim(findHeader(headers, SYNONYMS.cost, claimed));
  const category = claim(findHeader(headers, SYNONYMS.category, claimed));
  const taxable = claim(findHeader(headers, SYNONYMS.taxable, claimed));
  const description = claim(findHeader(headers, SYNONYMS.description, claimed));
  const name = claim(findHeader(headers, SYNONYMS.name, claimed));
  return { name, category, description, code, price, cost, taxable };
}

const TAXABLE_VALUES = new Set(["yes", "y", "true", "1", "taxable", "tax"]);

function cell(record: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (record[header] ?? "").trim();
}

export function buildServiceImportRows(records: Record<string, string>[], map: ServiceMappingConfig): ServiceBuildResult {
  const rows: ServiceImportRow[] = [];
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  records.forEach((record, rowIndex) => {
    const name = cell(record, map.name);
    if (!name) {
      skipped.push({ rowIndex, kind: "skipped", message: "No name — row skipped." });
      return;
    }

    const rawPrice = cell(record, map.price);
    let unitPriceCents = 0;
    if (rawPrice) {
      const parsed = parseMoneyCents(rawPrice);
      if (parsed === null) {
        warnings.push({ rowIndex, kind: "warning", message: `Couldn't read price "${rawPrice}" — imported at $0.` });
      } else {
        unitPriceCents = parsed;
      }
    }

    const rawCost = cell(record, map.cost);
    let costCents = 0;
    if (rawCost) {
      const parsed = parseMoneyCents(rawCost);
      if (parsed === null) {
        warnings.push({ rowIndex, kind: "warning", message: `Couldn't read cost "${rawCost}" — imported at $0.` });
      } else {
        costCents = parsed;
      }
    }

    const taxable = TAXABLE_VALUES.has(cell(record, map.taxable).toLowerCase());

    rows.push({
      name: name.slice(0, 500),
      category: cell(record, map.category).slice(0, 255) || null,
      description: cell(record, map.description).slice(0, 10000) || null,
      code: cell(record, map.code).slice(0, 120) || null,
      unitPriceCents,
      costCents,
      taxable,
    });
  });

  return { rows, skipped, warnings };
}
