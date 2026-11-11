export class AppError extends Error {
  public readonly details?: unknown;
  public readonly diagnostic?: Record<string, unknown>;

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "REQUEST_FAILED",
    details?: unknown,
    diagnostic?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.details = details;
    this.diagnostic = diagnostic ?? (details && typeof details === "object" ? details as Record<string, unknown> : undefined);
  }
}
