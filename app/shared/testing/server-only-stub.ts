/**
 * shared/testing/server-only-stub.ts
 *
 * What `import "server-only"` resolves to under Vitest.
 *
 * `server-only` is not a dependency — Next.js resolves that specifier itself, at build time, to a
 * module that throws if a client bundle pulls it in. Vitest has no such resolution, so any module
 * carrying the guard (`lib/auth/server-me.ts`, `lib/auth/server-measurement-gate.ts`) simply could
 * not be imported by a test at all: "Cannot find package 'server-only'". That left the shell's
 * server-side resolvers — including the one whose FAIL-SOFT behaviour is all that stands between a
 * settings blip and a 500 on every office page — with no unit coverage available to them.
 *
 * Empty on purpose. The guard's job is to fail a client BUILD, which is Next's concern; under test
 * the module is already running in Node, so there is nothing to enforce and nothing to stub.
 */
export {};
