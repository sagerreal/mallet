// Public surface for the inbound module — the only sanctioned import seam.
export { createInboundRouter } from "./api/inbound-router";
export { DrizzleInboundEndpointResolver } from "./infra/drizzle-inbound-endpoint-resolver";
export { DrizzleInboundEndpointRepository } from "./infra/drizzle-inbound-endpoint-repository";
export { DrizzleLeadReceiptRepository } from "./infra/drizzle-lead-receipt-repository";
export { IngestExternalLeadUseCase } from "./app/ingest-external-lead";
export { parserFor } from "./app/parsers/registry";
export { isChannel, CHANNELS, type Channel } from "./domain/channel";
