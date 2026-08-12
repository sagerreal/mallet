import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { logger } from "@mallet/shared/observability";
import { appRouter } from "@/trpc/root";
import { createContext } from "@/trpc/context";
import { getAppDeps } from "@/trpc/di";

export const runtime = "nodejs";
export const maxDuration = 300;

// How much of an unhandled error's text to keep. Enough to identify it, bounded so a huge driver
// dump cannot flood the log.
const DETAIL_MAX = 500;

// Single Next.js route that serves the whole tRPC tree under /api/trpc. Each request gets a
// fresh context (auth + deps); the org-scoped transaction opens inside the procedure middleware.
const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req, deps: getAppDeps() }),
    // The observability middleware records that a request failed, but never WHY — so an unhandled
    // throw was invisible server-side while being rendered, in full, to the user. (A missing
    // `users.callback_number` column had to be diagnosed from pg_stat_statements because of this.)
    // Now the message stays in the log and the client gets fixed copy — the opposite of before.
    //
    // Deliberately NOT logged: `error.cause` in full. postgres.js hangs the bound query parameters
    // off the error, and those are customer phone numbers, addresses and names.
    onError: ({ error, path, type }) => {
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      // The driver's own sentence ("duplicate key value violates …", "column x does not
      // exist"), WITHOUT the bound parameters (which carry customer PII — see above). For a
      // DrizzleQueryError the message is the query text and the real reason lives one cause
      // deeper; without this line the platform sweep had to guess a failed INSERT's constraint.
      const cause = error.cause as (Error & { cause?: Error }) | undefined;
      logger.error(
        {
          path,
          type,
          code: error.code,
          cause: cause?.constructor?.name ?? null,
          causeMessage: cause?.cause?.message?.slice(0, DETAIL_MAX) ?? null,
          detail: error.message.slice(0, DETAIL_MAX),
        },
        "trpc.unhandled",
      );
    },
  });

export { handler as GET, handler as POST };
