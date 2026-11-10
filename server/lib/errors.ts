/** Errors that are safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg = "Invalid request", code = "bad_request") => new HttpError(400, code, msg);
export const unauthorized = (msg = "Sign in required") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Forbidden", code = "forbidden") => new HttpError(403, code, msg);
export const notFound = (msg = "Not found") => new HttpError(404, "not_found", msg);
export const notConfigured = (what: string) => new HttpError(503, "not_configured", `${what} is not configured on this server`);
