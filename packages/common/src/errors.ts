/** Thrown by a consumer handler when retrying cannot help: the event goes straight to the DLQ. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** HTTP error with a status code, rendered by the shared Fastify error handler. */
export class HttpError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
