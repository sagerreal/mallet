/**
 * What a person is CALLED in chat.
 *
 * `users.name` is nullable — a staffer who never set a display name would otherwise appear as a
 * full email address in a bubble byline and a picker chip. The local part is the same fallback
 * the dispatch board uses (features/team/techs-hydrator.tsx): never the whole address, because
 * the domain is the same for everyone in the shop and adds no signal.
 */
export const displayNameOf = (name: string | null, email: string): string => {
  const trimmed = (name ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  return email.split("@")[0] || email;
};
