import { z } from "zod";

export const inboundEndpointDTO = z.object({
  channel: z.enum(["form", "angi", "thumbtack"]),
  token: z.string(),
  connected: z.boolean(),
  lastLeadAt: z.string().nullable(),
});

export const channelInput = z.object({ channel: z.enum(["form", "angi", "thumbtack"]) });
