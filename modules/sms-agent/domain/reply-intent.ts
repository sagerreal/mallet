// When the agent halts on a mutating tool it asks a yes/no question over text. The NEXT message
// from that staffer is therefore ambiguous: it might be the answer, or it might be them moving on
// to something else entirely. Getting this wrong in either direction is bad — read "actually,
// invoice the Miller job instead" as a YES and you run the thing they just changed their mind
// about; read "yep" as a new instruction and the agent has no idea what they are agreeing to.
//
// So the rule is deliberately narrow: ONLY a message that is essentially nothing but an
// affirmation or a refusal counts as an answer. Anything longer is a new instruction, and the
// pending action is abandoned rather than run. Abandoning is the safe failure — the staffer can
// always ask again; they cannot un-send an invoice.

export type ReplyIntent =
  | { readonly kind: "approve" }
  | { readonly kind: "deny" }
  | { readonly kind: "instruction" };

// Bare affirmations. Everything here means "do the thing you just described" and nothing else.
const AFFIRM = new Set([
  "y", "ye", "yes", "yep", "yeah", "yea", "yup", "ok", "okay", "k",
  "sure", "confirm", "confirmed", "do it", "go", "go ahead", "send it",
  "approve", "approved", "correct", "right", "yes please", "please do",
]);

// Bare refusals.
const DENY = new Set([
  "n", "no", "nope", "nah", "cancel", "stop", "dont", "don't", "do not",
  "no thanks", "nevermind", "never mind", "abort", "deny", "denied", "wrong",
]);

// Strip punctuation and casing so "Yes!" and "yes" land together. Keeps internal spaces and
// apostrophes because "go ahead" and "don't" are both in the tables above.
const normalize = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Classify an inbound message from a staffer who has a pending approval outstanding.
 *
 * @param body the raw SMS body
 * @param hasPending whether the agent is actually waiting on an answer. With nothing pending, a
 *        bare "yes" is just a word — it must NOT be treated as an approval of something older.
 */
export function classifyReply(body: string, hasPending: boolean): ReplyIntent {
  if (!hasPending) return { kind: "instruction" };

  const text = normalize(body);
  if (text.length === 0) return { kind: "instruction" };

  if (AFFIRM.has(text)) return { kind: "approve" };
  if (DENY.has(text)) return { kind: "deny" };

  // Anything else — including "yes but change the date" — is a new instruction. A qualified yes is
  // not a yes: the qualification is the point, and only the model can act on it.
  return { kind: "instruction" };
}
