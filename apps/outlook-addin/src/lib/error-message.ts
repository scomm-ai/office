/** Normalizes any thrown value into a display-ready message string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
