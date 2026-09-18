import type { Brand } from "./brand";

// Money is always integer cents (USD). Never a float — avoids rounding drift on totals.
export type Money = Brand<number, "Money">;

const CENTS_PER_DOLLAR = 100;

// Fail fast on a programmer error (a non-integer cent value is a bug, not a runtime condition).
export const money = (cents: number): Money => {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  return cents as Money;
};

export const zeroMoney: Money = 0 as Money;
export const addMoney = (a: Money, b: Money): Money => (a + b) as Money;
export const subMoney = (a: Money, b: Money): Money => (a - b) as Money;

export const fromDollars = (dollars: number): Money => money(Math.round(dollars * CENTS_PER_DOLLAR));
export const toDollars = (m: Money): number => m / CENTS_PER_DOLLAR;
export const formatUsd = (m: Money): string => `$${(m / CENTS_PER_DOLLAR).toFixed(2)}`;
