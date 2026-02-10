/**
 * Service-level error for expected failures (not found, bad state, etc.).
 * Route handlers catch these to return appropriate HTTP status codes.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
