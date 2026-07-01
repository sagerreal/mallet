// Relay tuning. Named so there are no magic numbers in the runner.
export const BATCH_SIZE = 50; // rows claimed per tick
export const MAX_ATTEMPTS = 8; // poison cap: a row past this is never re-claimed (a visible dead-letter)
export const BATCH_MIN = 1;
export const BATCH_MAX = 200;
export const MAX_ATTEMPTS_MIN = 1;
export const MAX_ATTEMPTS_MAX = 20;
