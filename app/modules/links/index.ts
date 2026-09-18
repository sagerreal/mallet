// Public surface for the links module — the only sanctioned import seam.
//
// A pure READ projection over four domains: the customer › quote › job › invoice trail every sheet
// shows in its header. It owns no table. It reads leads, estimates, jobs and invoices the same way
// invoicing's drizzle-job-reader and jobs' drizzle-estimate-reader already read across a boundary
// for a projection — the alternative is four bespoke client-side joins over paginated stores, which
// is precisely how the "—" customer names and the empty Archived tab happened.
export { createTrailRouter, trailDTO, TRAIL_KINDS } from "./api/trail-router";
export { DrizzleTrailReader, TRAIL_CAP } from "./infra/drizzle-trail-reader";
export type { Trail, TrailKind, TrailCustomer, TrailQuote, TrailJob, TrailInvoice, TrailCounts } from "./infra/drizzle-trail-reader";
