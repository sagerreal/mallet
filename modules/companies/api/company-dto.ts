import { z } from "zod";
import type { Company } from "../domain/company";

export const companyDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export type CompanyDTO = z.infer<typeof companyDTO>;

export const toCompanyDTO = (company: Company): CompanyDTO => {
  const p = company.props;
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    website: p.website,
    address: p.address,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  };
};
