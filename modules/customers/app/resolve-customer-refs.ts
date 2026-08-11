import type { Lead } from "../domain/lead";
import type { LeadRepository } from "../domain/lead-repository";
import type { EnsureCustomerUseCase } from "./ensure-customer";
import { Phone, isOk } from "@mallet/shared/types";

/**
 * Resolve "a customer named X with phone Y" to an actual lead, for a whole chunk at once.
 *
 * Bulk import is the reason this exists: a job CSV names its customer instead of carrying an id.
 * Resolving per row would put an N+1 across a 500-row chunk, so both lookup tables are loaded ONCE
 * up front and newly created customers are folded back in — the same shape as the category
 * resolution in `importServices`.
 *
 * Match order is phone → name → create:
 *   - PHONE is the only real key. `ensureCustomer` dedupes on it, and it survives spelling.
 *   - NAME is a fallback, not a key. An exact (case-insensitive) match with EXACTLY one live
 *     customer is taken; anything else is not.
 *   - AMBIGUOUS names create a new customer and report it. Attaching a job to the wrong Gary
 *     Pratt is invisible and unfixable; a duplicate customer is visible and mergeable. When the
 *     book already holds two people by one name, the import must not pick.
 */

export interface CustomerRef {
  readonly name: string;
  readonly phone: string | null;
}

export interface ResolvedCustomer {
  readonly lead: Lead;
  /** True when this row created the customer rather than matching an existing one. */
  readonly created: boolean;
  /**
   * Set when the name matched more than one live customer. The row still imports — against a NEW
   * customer — and the caller surfaces this so the shop can merge deliberately.
   */
  readonly ambiguousName?: string;
}

export interface ResolveCustomerRefsDeps {
  readonly leads: LeadRepository;
  readonly ensureCustomer: EnsureCustomerUseCase;
}

const normalise = (name: string): string => name.trim().toLowerCase();

export class ResolveCustomerRefsUseCase {
  constructor(private readonly deps: ResolveCustomerRefsDeps) {}

  /**
   * Resolve every ref in order, returning one result per input index. A ref that cannot be
   * resolved OR created (a domain rejection, e.g. an empty name) yields null for that index — the
   * caller decides whether that skips the row.
   */
  async exec(refs: readonly CustomerRef[], source: string | null): Promise<(ResolvedCustomer | null)[]> {
    const byPhone = new Map<string, Lead>();
    const byName = new Map<string, Lead[]>();

    // One read per lookup dimension for the whole chunk, not per row.
    const names = refs.map((r) => r.name);
    for (const lead of await this.deps.leads.findByNames(names)) {
      const key = normalise(lead.props.name);
      const bucket = byName.get(key);
      if (bucket) bucket.push(lead);
      else byName.set(key, [lead]);
      if (lead.props.phone) byPhone.set(lead.props.phone, lead);
    }

    const out: (ResolvedCustomer | null)[] = [];

    for (const ref of refs) {
      const parsedPhone = ref.phone ? Phone.parse(ref.phone) : null;
      const phone = parsedPhone && isOk(parsedPhone) ? parsedPhone.value : null;

      // 1. Phone — the only real key.
      if (phone) {
        const hit = byPhone.get(phone);
        if (hit) {
          out.push({ lead: hit, created: false });
          continue;
        }
      }

      // 2. Name — taken only when it identifies exactly one customer.
      const matches = byName.get(normalise(ref.name)) ?? [];
      if (matches.length === 1 && !phone) {
        out.push({ lead: matches[0]!, created: false });
        continue;
      }

      // 3. Create. Also the path for an ambiguous name, deliberately.
      const created = await this.deps.ensureCustomer.exec({
        name: ref.name,
        phone,
        email: null,
        source,
        companyId: null,
        role: null,
        notes: null,
        address: null,
      });
      if (!isOk(created)) {
        out.push(null);
        continue;
      }

      // Fold the new customer into both tables so a later row in the SAME chunk naming the same
      // person reuses it instead of creating a second one.
      const lead = created.value.lead;
      if (lead.props.phone) byPhone.set(lead.props.phone, lead);
      const key = normalise(lead.props.name);
      byName.set(key, [...(byName.get(key) ?? []), lead]);

      out.push({
        lead,
        created: created.value.created,
        ...(matches.length > 1 ? { ambiguousName: ref.name } : {}),
      });
    }

    return out;
  }
}
