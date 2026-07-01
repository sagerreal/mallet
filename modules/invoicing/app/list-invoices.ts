import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter } from "../domain/invoice-repository";

export interface ListInvoicesQuery {
  readonly page: CursorPage;
  readonly filter?: InvoiceFilter;
}

// Thin read use-case: keyset-paginate the org's invoices. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in.
export class ListInvoicesUseCase {
  constructor(private readonly repo: InvoiceRepository) {}

  exec(query: ListInvoicesQuery): Promise<Paginated<Invoice>> {
    return this.repo.list(query.page, query.filter);
  }
}
