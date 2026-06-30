// Liveness vs readiness. Liveness answers "is the process up?" (no dependencies — a failing
// liveness means restart me). Readiness answers "can I serve traffic?" — it checks the DB is
// reachable, so a load balancer can pull the instance out while a dependency is down.

export interface CheckResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface HealthReport {
  readonly status: "ok" | "error";
  readonly checks?: Readonly<Record<string, CheckResult>>;
}

export const liveness = (): HealthReport => ({ status: "ok" });

// `ping` performs the actual dependency probe (e.g. `select 1`). Injected so this stays pure.
export const readiness = async (ping: () => Promise<void>): Promise<HealthReport> => {
  try {
    await ping();
    return { status: "ok", checks: { database: { ok: true } } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { status: "error", checks: { database: { ok: false, error: message } } };
  }
};
