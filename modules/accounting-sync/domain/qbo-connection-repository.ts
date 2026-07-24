import type { QboConnection } from "./qbo-connection";

export interface QboConnectionRepository {
  /** The org's connection, or null if it has never connected. */
  get(): Promise<QboConnection | null>;

  /**
   * Same as get(), but takes a row lock (SELECT ... FOR UPDATE) for the life of the transaction.
   *
   * This exists for exactly one reason: Intuit rotates the refresh token on every exchange and
   * invalidates the previous value. Two concurrent requests that both see a stale access token
   * would both refresh; the second exchange presents a refresh token Intuit has already retired,
   * so it fails — and worse, whichever write lands last can clobber the good token with a dead
   * one. Serialising the read-refresh-write under a row lock makes the loser wait and re-read the
   * winner's fresh token instead of racing it.
   */
  getForUpdate(): Promise<QboConnection | null>;

  /** Insert or update the org's single connection row. */
  save(connection: QboConnection): Promise<void>;
}
