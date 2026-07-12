export const CHANNELS = ["form", "angi", "thumbtack"] as const;
export type Channel = (typeof CHANNELS)[number];
export function isChannel(v: string): v is Channel {
  return (CHANNELS as readonly string[]).includes(v);
}
