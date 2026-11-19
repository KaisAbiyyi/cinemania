export function isPostgresCapacityError(error: unknown): boolean {
  return error instanceof Error && (
    ("code" in error && (error.code === "53300" || error.code === "EMAXCONNSESSION")) ||
    /\bEMAXCONNSESSION\b/.test(error.message)
  );
}
