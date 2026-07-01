import type { CursorPage, Paginated } from "@mallet/shared/types";
import type { Notification } from "../domain/notification";
import type { NotificationRepository, NotificationFilter } from "../domain/notification-repository";

export interface ListNotificationsQuery {
  readonly page: CursorPage;
  readonly filter?: NotificationFilter;
}

// Thin read use-case: keyset-paginate the org's sent messages. Tenant scoping is enforced by the
// org-scoped transaction the repository runs in.
export class ListNotificationsUseCase {
  constructor(private readonly repo: NotificationRepository) {}

  exec(query: ListNotificationsQuery): Promise<Paginated<Notification>> {
    return this.repo.list(query.page, query.filter);
  }
}
