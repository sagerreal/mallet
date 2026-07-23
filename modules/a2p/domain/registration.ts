import { ok, err, type Result, type ValidationError } from "@mallet/shared/types";
import { validation } from "@mallet/shared/types";

export type A2pStatus =
  | "not_started" | "collecting" | "profile_pending" | "brand_pending"
  | "campaign_pending" | "number_pending" | "active" | "failed";

export interface BusinessInfo {
  legalName: string; ein: string | null;
  addressStreet: string; addressCity: string; addressRegion: string; addressPostal: string;
  industry: string; websiteUrl: string;
  contactFirstName: string; contactLastName: string; contactEmail: string; contactPhone: string;
}

export interface A2pRegistrationProps {
  orgId: string; status: A2pStatus;
  secondaryProfileSid: string | null; brandSid: string | null;
  messagingServiceSid: string | null; campaignSid: string | null; phoneNumberSid: string | null;
  businessInfo: BusinessInfo | null; otpVerified: boolean; failureReason: string | null;
}

export function brandKind(info: BusinessInfo): "standard" | "sole_proprietor" {
  return info.ein === null ? "sole_proprietor" : "standard";
}

export class A2pRegistration {
  private constructor(readonly props: A2pRegistrationProps) {}

  static create(props: A2pRegistrationProps): Result<A2pRegistration, ValidationError> {
    if (!props.orgId) return err(validation("orgId is required", "orgId"));
    return ok(new A2pRegistration(props));
  }

  private next(patch: Partial<A2pRegistrationProps>): A2pRegistration {
    return new A2pRegistration({ ...this.props, ...patch });
  }

  withBusinessInfo(info: BusinessInfo): A2pRegistration {
    return this.next({ businessInfo: info, status: "collecting" });
  }
  withProfile(sid: string): A2pRegistration {
    return this.next({ secondaryProfileSid: sid, status: "profile_pending" });
  }
  withBrand(sid: string): A2pRegistration {
    return this.next({ brandSid: sid, status: "brand_pending" });
  }
  withMessagingService(sid: string): A2pRegistration {
    return this.next({ messagingServiceSid: sid });
  }
  withCampaign(sid: string): A2pRegistration {
    return this.next({ campaignSid: sid, status: "campaign_pending" });
  }
  withNumber(sid: string): A2pRegistration {
    return this.next({ phoneNumberSid: sid, status: "number_pending" });
  }
  markActive(): A2pRegistration {
    return this.next({ status: "active", failureReason: null });
  }
  markFailed(reason: string): A2pRegistration {
    return this.next({ status: "failed", failureReason: reason });
  }
}
