import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import { isChannel, type Channel } from "./channel";

const TOKEN_RE = /^[0-9a-f]{64}$/;

export interface InboundEndpointProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly channel: Channel;
  readonly token: string;
  readonly lastLeadAt: Date | null;
  readonly createdAt: Date;
}

export class InboundEndpoint {
  private constructor(private readonly p: InboundEndpointProps) {}
  get props(): InboundEndpointProps { return this.p; }
  get isConnected(): boolean { return this.p.lastLeadAt !== null; }

  static create(props: InboundEndpointProps): Result<InboundEndpoint, ValidationError> {
    if (!isChannel(props.channel)) return err(validation(`invalid channel: ${props.channel}`, "channel"));
    if (!TOKEN_RE.test(props.token)) return err(validation("token must be 64 hex chars", "token"));
    return ok(new InboundEndpoint(props));
  }
}
