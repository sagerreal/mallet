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

function findHeader(headers: string[], candidates: string[], claimed: Set<string>): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h, i) => !claimed.has(headers[i]!) && h.includes(cand));
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

export function autoMap(headers: string[]): MappingConfig {
  const claimed = new Set<string>();
  const claim = (h: string | null): string | null => {
    if (h) claimed.add(h);
    return h;
  };
  // Specific / collision-prone fields claim their header first, so no header is double-assigned.
  const lastName = claim(findHeader(headers, ["last name", "surname", "family name"], claimed));
  const email = claim(findHeader(headers, SYNONYMS.email, claimed));
  const phone = claim(findHeader(headers, SYNONYMS.phone, claimed));
  const name = claim(findHeader(headers, SYNONYMS.name, claimed));
  const address = claim(findHeader(headers, SYNONYMS.address, claimed));
  const notes = claim(findHeader(headers, SYNONYMS.notes, claimed));
  return { name, lastName, phone, email, address, notes, sourceTag: "Import" };
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
      // Clamp to the server's 320-char boundary: sending a longer value would reject the batch.
      if (EMAIL_RE.test(rawEmail)) email = rawEmail.slice(0, 320);
      else warnings.push({ rowIndex, kind: "warning", message: `Couldn't read email "${rawEmail}" — imported without it.` });
    }

    rows.push({
      name: name.slice(0, 255),
      phone,
      email,
      address: cell(record, map.address).slice(0, 500) || null,
      // sourceTag is one constant applied to every row, so an over-long tag would reject the WHOLE
      // batch at the server's z.string().max(255). Clamp here to keep "client sends only valid rows".
      source: map.sourceTag.trim().slice(0, 255) || null,
      notes: cell(record, map.notes).slice(0, 2000) || null,
    });
  });

  return { rows, skipped, warnings };
}
