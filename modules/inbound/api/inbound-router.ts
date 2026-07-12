import { randomBytes } from "node:crypto";
import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { DrizzleInboundEndpointRepository } from "../infra/drizzle-inbound-endpoint-repository";
import { inboundEndpointDTO, channelInput } from "./inbound-dto";
import type { InboundEndpoint } from "../domain/inbound-endpoint";

const generateToken = (): string => randomBytes(32).toString("hex");

const toDTO = (e: InboundEndpoint) => ({
  channel: e.props.channel,
  token: e.props.token,
  connected: e.isConnected,
  lastLeadAt: e.props.lastLeadAt?.toISOString() ?? null,
});

// Layer 5: thin transport. Org id is ALWAYS ctx.principal.orgId — never client input.
export const createInboundRouter = () =>
  router({
    list: ownerOrOffice.output(z.array(inboundEndpointDTO)).query(async ({ ctx }) => {
      const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
      return (await repo.listByOrg()).map(toDTO);
    }),

    // Idempotent: a channel that already has an endpoint returns its existing token rather
    // than minting a new one (repeated "generate" clicks must not invalidate a live webhook URL).
    generate: ownerOrOffice
      .input(channelInput)
      .output(inboundEndpointDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
        const existing = await repo.findByChannel(input.channel);
        const endpoint = existing ?? (await repo.create(input.channel, generateToken()));
        return toDTO(endpoint);
      }),

    rotate: ownerOrOffice
      .input(channelInput)
      .output(inboundEndpointDTO.nullable())
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
        const rotated = await repo.rotateToken(input.channel, generateToken());
        return rotated ? toDTO(rotated) : null;
      }),

    disable: ownerOrOffice
      .input(channelInput)
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInboundEndpointRepository(ctx.tx, ctx.principal.orgId);
        await repo.softDelete(input.channel);
        return { ok: true as const };
      }),
  });
