// Time as an injected dependency — so use-cases are pure and testable (no hidden `new Date()`).
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

// For tests: deterministic, advanceable time.
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
