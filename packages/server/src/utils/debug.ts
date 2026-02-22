const DEBUG =
  process.env.OTTERBOT_DEBUG === "1" ||
  process.env.OTTERBOT_DEBUG === "true";

export function debug(tag: string, ...args: unknown[]): void {
  if (DEBUG) console.log(`[DEBUG:${tag}]`, ...args);
}
