/**
 * Structured Logger
 *
 * Lightweight, zero-dependency logging utility.
 * - debug/info: only in dev mode (import.meta.env.DEV)
 * - warn/error: always visible
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function isDev(): boolean {
  try {
    return import.meta.env.DEV;
  } catch {
    return false;
  }
}

function format(level: LogLevel, msg: string): string {
  return `[${level.toUpperCase()}] ${msg}`;
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (isDev()) console.debug(format("debug", msg), ...args);
  },
  info(msg: string, ...args: unknown[]): void {
    if (isDev()) console.info(format("info", msg), ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    console.warn(format("warn", msg), ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    console.error(format("error", msg), ...args);
  },
};
