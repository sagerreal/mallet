// Nominal ("branded") types: a base type tagged so it isn't interchangeable
// with another value of the same base type (e.g. an OrgId can't be passed where a LeadId is expected).
declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };
