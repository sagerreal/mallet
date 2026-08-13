/**
 * features/team-chat/thread-labels.ts
 * What a conversation is CALLED and what its second line says. Pure — no React, no store, so
 * both the list and its tests read the same rules.
 */

import type { TeamThreadDTO } from "@mallet/team-chat";

/** Initials for a row avatar. Splits on spaces, dots, @ and dashes so an email works too. */
export function initialsOf(nameOrEmail: string): string {
  const parts = (nameOrEmail || "").split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return "??";
  // One word gets its first TWO letters ("alice" → AL); several give one each ("Mike
  // Rivera" → MR). Matches the dispatch board's avatars, so one person looks the same
  // in the crew lane and in a conversation.
  const letters =
    parts.length === 1 ? (parts[0] ?? "").slice(0, 2) : parts.map((p) => p[0] ?? "").join("");
  return (letters.slice(0, 2) || "??").toUpperCase();
}

/**
 * A group has its own name; a DM is named after the OTHER person — which is why the member list
 * rides the inbox row (the field shell has no roster to look anyone up in).
 */
export function threadTitle(t: TeamThreadDTO, meUserId: string | undefined): string {
  if (t.kind === "group") return t.title ?? "Group";
  return t.members.find((m) => m.userId !== meUserId)?.name ?? "Teammate";
}

/** The second line: who said what, or that a photo came through. */
export function previewOf(t: TeamThreadDTO, meUserId: string | undefined): string {
  const mine = Boolean(t.lastAuthorUserId) && t.lastAuthorUserId === meUserId;
  const body = t.lastBody.trim();
  const text = body || (t.lastHadAttachment ? "Photo" : "No messages yet");
  const full = `${mine ? "You: " : ""}${text}`;
  return full.length > 72 ? `${full.slice(0, 72)}…` : full;
}
