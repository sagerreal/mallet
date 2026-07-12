// The single contract every channel parser targets. Fields are already trimmed; name is required
// (a lead with no name is rejected upstream). externalId is the source's stable id for idempotency
// (null for the form channel, which has none).
export interface NormalizedLead {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly externalId: string | null;
}
