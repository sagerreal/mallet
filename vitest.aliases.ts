import { resolve } from "node:path";

// Mirror the tsconfig path aliases (longest prefix first). Shared by the unit and integration
// vitest configs so they never drift.
export const malletAliases = (root: string): Array<{ find: RegExp; replacement: string }> => [
  { find: /^@mallet\/shared\/(.*)$/, replacement: resolve(root, "shared/$1") },
  { find: /^@mallet\/platform\/(.*)$/, replacement: resolve(root, "platform/$1") },
  { find: /^@mallet\/workflows\/(.*)$/, replacement: resolve(root, "workflows/$1") },
  { find: /^@mallet\/(.*)$/, replacement: resolve(root, "modules/$1") },
  { find: /^@\/(.*)$/, replacement: resolve(root, "$1") },
];
