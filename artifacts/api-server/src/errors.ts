export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public missing?: string[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function blocked(missing: string[], message: string): HttpError {
  return new HttpError(503, "BLOCKED", message, missing);
}
