/**
 * modules/quoting/domain/quantity-expression.ts
 *
 * A line's quantity may be TYPED MATH rather than a number: an assembly's children are
 * counted off the parent's driver quantity ("qty/8+1" posts for a fence run), so changing
 * the driver reprices every child.
 *
 * The expression is the AUTHORING layer, never the source of truth. `estimate_lines.quantity`
 * stays the resolved number every total, DTO, public page and invoice already reads; this
 * module is what turns one into the other, and the server re-runs it on every write so a
 * client can never persist a quantity its own expression does not produce.
 *
 * Pure — no I/O, no Date, no randomness — so the composer can run it live on a keystroke and
 * the domain can run it on save and get the same answer, the same way quote-totals.ts is
 * shared with the public page.
 *
 * The grammar is deliberately tiny: numbers, + - * / and parentheses, the driver token, and
 * five rounding helpers. It is a closed recursive-descent parser rather than anything that
 * evaluates arbitrary strings — the expression is user input that gets stored and re-run.
 */

import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/** What an estimator types to mean "the parent's quantity". */
export const DRIVER_TOKEN = "qty";

/** Kept working for expressions written before the token was settled. */
const DRIVER_ALIASES = ["run"];

/** `estimate_lines.qty_expr` is text, but a quantity expression is a short thing. */
export const MAX_QTY_EXPR_LENGTH = 120;

/** `quantity` is numeric(12,2) — a resolved quantity must fit it. */
const QUANTITY_DECIMALS = 2;

const HELPERS: Record<string, (...args: number[]) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  max: Math.max,
  min: Math.min,
};

const VARIADIC_HELPERS = new Set(["max", "min"]);

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" | "," }
  | { kind: "end" };

const badMath = (): ValidationError =>
  validation("Check the math — use numbers, qty, + − × ÷ and ( )", "qtyExpr");

/** A plain typed number, thousands separators and all — not an expression. */
function plainNumber(raw: string): number | null {
  if (!/^[\d,]+(?:\.\d*)?$/.test(raw)) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function tokenize(raw: string): Token[] | null {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const char = raw[cursor] as string;
    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }
    const number = raw.slice(cursor).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      cursor += number[0].length;
      continue;
    }
    const name = raw.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (name) {
      tokens.push({ kind: "name", value: name[0] });
      cursor += name[0].length;
      continue;
    }
    if ("+-*/(),".includes(char)) {
      tokens.push({ kind: "op", value: char as "+" });
      cursor += 1;
      continue;
    }
    return null;
  }
  tokens.push({ kind: "end" });
  return tokens;
}

/**
 * Evaluate one quantity expression. `driver` is the parent's quantity; an absent driver reads
 * as 0 so a child on a driverless line resolves to nothing rather than failing the estimate.
 * `unitAlias` lets a shop's own unit stand in for the token ("LF/8+1"), case-insensitively.
 */
export function evaluateQuantityExpression(
  expression: string,
  driver: number = 0,
  unitAlias?: string | null,
): Result<number, ValidationError> {
  const raw = String(expression ?? "").trim();
  if (raw === "") return err(validation("Enter a quantity", "qtyExpr"));
  if (raw.length > MAX_QTY_EXPR_LENGTH) {
    return err(validation(`That is too long — keep it under ${MAX_QTY_EXPR_LENGTH} characters`, "qtyExpr"));
  }

  const typed = plainNumber(raw);
  if (typed !== null) return ok(typed);

  const parsed = tokenize(raw);
  if (!parsed) return err(badMath());
  const tokens: Token[] = parsed;

  const driverNames = new Set(
    [DRIVER_TOKEN, ...DRIVER_ALIASES, unitAlias ?? ""].filter(Boolean).map((name) => name.toLowerCase()),
  );

  let index = 0;
  const peek = (): Token => tokens[index] ?? { kind: "end" };
  const isOp = (value: string): boolean => {
    const token = peek();
    return token.kind === "op" && token.value === value;
  };

  // expression := term (('+' | '-') term)*
  function parseExpression(): number {
    let value = parseTerm();
    while (isOp("+") || isOp("-")) {
      const operator = (peek() as { value: string }).value;
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  // term := unary (('*' | '/') unary)*
  function parseTerm(): number {
    let value = parseUnary();
    while (isOp("*") || isOp("/")) {
      const operator = (peek() as { value: string }).value;
      index += 1;
      const right = parseUnary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseUnary(): number {
    if (isOp("+")) {
      index += 1;
      return parseUnary();
    }
    if (isOp("-")) {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.kind === "number") {
      index += 1;
      return token.value;
    }
    if (isOp("(")) {
      index += 1;
      const value = parseExpression();
      if (!isOp(")")) throw badMath();
      index += 1;
      return value;
    }
    if (token.kind === "name") {
      const name = token.value;
      index += 1;
      if (driverNames.has(name.toLowerCase()) && !isOp("(")) return driver;
      const helper = HELPERS[name.toLowerCase()];
      if (!helper || !isOp("(")) throw badMath();
      index += 1;
      const args: number[] = [];
      if (!isOp(")")) {
        args.push(parseExpression());
        while (isOp(",")) {
          index += 1;
          args.push(parseExpression());
        }
      }
      if (!isOp(")")) throw badMath();
      index += 1;
      const variadic = VARIADIC_HELPERS.has(name.toLowerCase());
      if (args.length === 0 || (!variadic && args.length !== 1)) throw badMath();
      return helper(...args);
    }
    throw badMath();
  }

  try {
    const value = parseExpression();
    if (peek().kind !== "end") return err(badMath());
    if (!Number.isFinite(value)) return err(badMath());
    return ok(value);
  } catch {
    return err(badMath());
  }
}

export interface ResolveQuantityInput {
  /** The stored quantity — used as-is when there is no expression. */
  readonly quantity: number;
  /** The typed math, when the estimator authored one. */
  readonly qtyExpr?: string | null;
  /** The parent line's quantity, for a child. */
  readonly driver?: number | null;
  /** Round the result up to a whole unit — you cannot buy half a post. */
  readonly roundUp?: boolean;
  /** The parent's unit, accepted as an alias for the driver token. */
  readonly unitAlias?: string | null;
}

/**
 * The one place a line's quantity is decided. Callers persist what this returns, so the stored
 * `quantity` and the stored `qty_expr` can never disagree.
 */
export function resolveLineQuantity(input: ResolveQuantityInput): Result<number, ValidationError> {
  const expression = input.qtyExpr?.trim();
  let value: number;
  if (expression) {
    const evaluated = evaluateQuantityExpression(expression, input.driver ?? 0, input.unitAlias);
    if (!evaluated.ok) return evaluated;
    value = evaluated.value;
  } else {
    value = input.quantity;
  }
  if (!Number.isFinite(value)) return err(badMath());
  const rounded = input.roundUp ? Math.ceil(value) : value;
  const factor = 10 ** QUANTITY_DECIMALS;
  return ok(Math.round(rounded * factor) / factor);
}
