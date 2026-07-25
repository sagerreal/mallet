import type { UserId, Phone, Result, AppError } from "@mallet/shared/types";
import { Phone as PhoneParser, ok, isOk } from "@mallet/shared/types";
import type { AgentNumberStore } from "../domain/call-directory";

export interface SetCallbackNumberCmd {
  readonly userId: UserId;
  // Null (or blank) clears the number. Anything else must parse as a phone number.
  readonly callbackNumber: string | null;
}

// Sets the mobile Mallet rings first on an outbound click-to-call, for ONE person — their own.
//
// The number is stored on the user, so this is the durable path: `place` can also remember a
// number supplied inline, but that write lives inside the call's transaction and rolls back with
// it. Settings is where a number survives a failed call, and where a typo can be corrected.
export class SetCallbackNumberUseCase {
  constructor(private readonly agents: AgentNumberStore) {}

  async exec(cmd: SetCallbackNumberCmd): Promise<Result<Phone | null, AppError>> {
    const raw = cmd.callbackNumber?.trim() ?? "";

    // An explicit clear, not a silent no-op: someone removing their number must end up with none.
    if (raw.length === 0) {
      await this.agents.save(cmd.userId, null);
      return ok(null);
    }

    const parsed = PhoneParser.parse(raw);
    if (!isOk(parsed)) return parsed;

    await this.agents.save(cmd.userId, parsed.value);
    return ok(parsed.value);
  }
}
