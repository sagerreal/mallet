import { A2pRegistration, type A2pStatus, type BusinessInfo } from "../domain/registration";

type Row = {
  orgId: string; status: string;
  secondaryProfileSid: string | null; brandSid: string | null;
  messagingServiceSid: string | null; campaignSid: string | null; phoneNumberSid: string | null;
  businessInfo: unknown; otpVerified: boolean; failureReason: string | null;
};

export function toDomain(row: Row): A2pRegistration {
  const r = A2pRegistration.create({
    orgId: row.orgId,
    status: row.status as A2pStatus,
    secondaryProfileSid: row.secondaryProfileSid,
    brandSid: row.brandSid,
    messagingServiceSid: row.messagingServiceSid,
    campaignSid: row.campaignSid,
    phoneNumberSid: row.phoneNumberSid,
    businessInfo: (row.businessInfo as BusinessInfo | null) ?? null,
    otpVerified: row.otpVerified,
    failureReason: row.failureReason,
  });
  if (!r.ok) throw new Error(`corrupt a2p_registrations row for org ${row.orgId}`);
  return r.value;
}

export function toRow(reg: A2pRegistration) {
  const p = reg.props;
  return {
    orgId: p.orgId, status: p.status,
    secondaryProfileSid: p.secondaryProfileSid, brandSid: p.brandSid,
    messagingServiceSid: p.messagingServiceSid, campaignSid: p.campaignSid,
    phoneNumberSid: p.phoneNumberSid,
    businessInfo: p.businessInfo, otpVerified: p.otpVerified, failureReason: p.failureReason,
    updatedAt: new Date(),
  };
}
