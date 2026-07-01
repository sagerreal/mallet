import { randomUUID } from "node:crypto";

// Generates fresh entity ids. Injected (like Clock) so use-cases that build an aggregate app-side
// stay deterministic under test — a fake yields sequential ids.
export interface IdGenerator {
  newId(): string;
}

export const uuidGenerator: IdGenerator = {
  newId: () => randomUUID(),
};
