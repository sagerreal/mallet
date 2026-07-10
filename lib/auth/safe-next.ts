// Pure helper: validate a `next` redirect target so it cannot be used for open-redirect attacks.
// A safe next value must:
//   - be a non-empty string
//   - start with "/" (relative path)
//   - NOT start with "//" (protocol-relative URL — browser treats as absolute)
//   - contain no scheme (no ":")
//
// Returns `defaultPath` when `next` is absent, empty, or unsafe.
export function safeNext(next: string | null | undefined, defaultPath: string): string {
  if (!next) return defaultPath;
  if (!next.startsWith("/")) return defaultPath;
  if (next.startsWith("//")) return defaultPath;
  if (next.includes(":")) return defaultPath;
  return next;
}
