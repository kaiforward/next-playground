/**
 * Service-level error for expected failures (not found, no world loaded). `kind` is a
 * discriminant naming which expected failure this is — there is no HTTP layer left to translate
 * a status code into (routes and `withServiceErrors` are gone at Task 14); the worker's command
 * handlers and read paths match on `kind` directly.
 */
export type ServiceErrorKind = "not_found" | "no_world";

export class ServiceError extends Error {
  constructor(
    message: string,
    public kind: ServiceErrorKind,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
