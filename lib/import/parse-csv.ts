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
