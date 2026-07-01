import type { AuthProvider } from "@mallet/identity";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";

// The application's outward dependencies, injected at the composition root. Use-cases receive
// these (never construct adapters themselves), so tests substitute fakes freely.
export interface AppDeps {
  readonly authProvider: AuthProvider;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
