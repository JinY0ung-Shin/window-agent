/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * This is the single source of truth for converting caught errors into strings
 * across the codebase.  Use this instead of ad-hoc `e instanceof Error ? e.message : String(e)`.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const str = String(error);
  return str === "[object Object]" ? "Unknown error" : str;
}
