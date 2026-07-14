// The book_visit boundary contract: the closed lane/urgency enums, the zod input the runner validates
// model args against, and the model-facing JSON schema Vapi forwards to the LLM. Split out from
// book-visit.ts so the phrasing helpers (book-visit-speak.ts) can depend on the INPUT TYPE without a
// circular import back through the tool, and so book-visit.ts stays under the file-size limit.
import { z } from "zod";

// The three booking lanes + urgencies (mirror check_availability's closed enums so the model can't
// smuggle a garbage lane past the boundary). repair/flat book a work job; estimate books a scope
// visit as an estimate-kind job so it rides the board unchanged.
export const BOOK_LANES = ["repair", "estimate", "flat"] as const;
export type BookLane = (typeof BOOK_LANES)[number];
export const BOOK_URGENCIES = ["normal", "emergency"] as const;
export type BookLaneUrgency = (typeof BOOK_URGENCIES)[number];

// The default urgency: an emergency is the exception, so a normal call must NOT dead-end just because
// the model didn't classify urgency. `urgency` is OPTIONAL here (defaults to this) and is therefore
// NOT in the JSON-schema required[]. `problem` stays REQUIRED and IS listed in required[] so the zod
// input and the model-facing JSON schema agree (a mismatch would silently reject valid LLM calls).
export const DEFAULT_URGENCY: BookLaneUrgency = "normal";

export const bookVisitInput = z.object({
  caller_name: z.string().min(1),
  phone: z.string(),
  address: z.string(),
  service_name: z.string().min(1),
  lane: z.enum(BOOK_LANES),
  problem: z.string(),
  slot_date: z.string(),
  slot_start: z.string(),
  urgency: z.enum(BOOK_URGENCIES).default(DEFAULT_URGENCY),
});
export type BookVisitInput = z.infer<typeof bookVisitInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal so
// the model-facing contract is reviewable in one place (matches the house style of the other tools).
export const bookVisitParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    caller_name: { type: "string", description: "The caller's full name." },
    phone: { type: "string", description: "The caller's callback number, confirmed digit-by-digit." },
    address: { type: "string", description: "The service address, read back to the caller." },
    service_name: { type: "string", description: "The service being booked (from the playbook)." },
    lane: {
      type: "string",
      enum: [...BOOK_LANES],
      description: "repair, estimate, or flat — the playbook lane for this service.",
    },
    problem: { type: "string", description: "What the caller described in their own words." },
    slot_date: { type: "string", description: 'The chosen slot date, "YYYY-MM-DD".' },
    slot_start: {
      type: "string",
      description: "The chosen slot start time HH:MM, from check_availability.",
    },
    urgency: {
      type: "string",
      enum: [...BOOK_URGENCIES],
      description: "normal, or emergency for a true emergency booked ASAP.",
    },
  },
  // Agrees with the zod input: everything the handler needs is required EXCEPT urgency (optional,
  // defaults to "normal"). problem IS required here so the schema the model sees matches zod.
  required: [
    "caller_name",
    "phone",
    "address",
    "service_name",
    "lane",
    "problem",
    "slot_date",
    "slot_start",
  ],
  additionalProperties: false,
};
