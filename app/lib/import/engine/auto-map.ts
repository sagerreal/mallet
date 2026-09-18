/**
 * Best-guess a header for each descriptor field.
 *
 * Generalises the two hand-written `autoMap` functions. Both used the same trick and it is
 * preserved here because it is load-bearing: fields CLAIM their header in order, so a
 * collision-prone specific field takes its column before a generic one can grab it. "Item code"
 * must be claimed by `code` before `name`'s "item" synonym reaches it, and "Last name" must be
 * claimed before `name`'s "name" synonym swallows it.
 *
 * Claim order is SYNONYM SPECIFICITY, not descriptor order: a field whose most specific synonym is
 * longer goes first. That reproduces the hand-tuned ordering of both existing importers without
 * asking every descriptor author to think about it.
 */

import type { ImportDescriptor, ImportFieldSpec, MappingConfig } from "./descriptor";

/** One claimable target: either a field, or a field's `combinesWith` partner. */
interface Claimable {
  readonly key: string;
  readonly synonyms: readonly string[];
}

function findHeader(
  headers: readonly string[],
  candidates: readonly string[],
  claimed: ReadonlySet<string>,
): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.findIndex((h, i) => !claimed.has(headers[i]!) && h.includes(candidate));
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

/**
 * How specific a target is — the length of its longest synonym. "last name" (9) beats "name" (4),
 * so it claims first. Ties keep declaration order, which `Array.prototype.sort` guarantees.
 */
const specificity = (c: Claimable): number =>
  c.synonyms.reduce((max, s) => Math.max(max, s.length), 0);

function claimablesOf(fields: readonly ImportFieldSpec[]): Claimable[] {
  const out: Claimable[] = [];
  for (const field of fields) {
    out.push({ key: field.key, synonyms: field.synonyms });
    if (field.combinesWith) {
      out.push({ key: field.combinesWith.key, synonyms: field.combinesWith.synonyms });
    }
  }
  return out;
}

/**
 * Map every field key (and `combinesWith` partner key) to a header, or null when nothing matched.
 * The descriptor's constant, if any, is seeded with its default value rather than a header name.
 */
export function autoMap(headers: readonly string[], descriptor: ImportDescriptor): MappingConfig {
  const claimed = new Set<string>();
  const mapping: MappingConfig = {};

  const targets = claimablesOf(descriptor.fields).sort((a, b) => specificity(b) - specificity(a));

  // TWO PASSES. findHeader matches by substring, which is what lets "Customer First Name" find
  // `name` — but it also let `unitOfMeasure`, whose synonyms include a bare "unit", swallow a
  // supplier's "Unit Cost" column before `unitCostCents` was ever offered it. The cost then
  // mapped to nothing and every material imported at $0, reported as a success.
  //
  // So: pass 1 hands out only headers that ARE a synonym, exactly. A header that names a field
  // outright belongs to that field, whatever some other field's substring would also match.
  // Pass 2 is the original substring sweep over whatever is still unclaimed, so "Material Unit"
  // and friends still land.
  for (const target of targets) {
    const exact = headers.find(
      (h) => !claimed.has(h) && target.synonyms.includes(h.toLowerCase()),
    );
    if (exact) {
      claimed.add(exact);
      mapping[target.key] = exact;
    }
  }

  for (const target of targets) {
    if (mapping[target.key]) continue;
    const header = findHeader(headers, target.synonyms, claimed);
    if (header) claimed.add(header);
    mapping[target.key] = header;
  }

  if (descriptor.constant) {
    mapping[descriptor.constant.key] = descriptor.constant.defaultValue;
  }

  return mapping;
}
