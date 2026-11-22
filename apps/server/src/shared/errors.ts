import type { ErrorRequestHandler } from "express";

/**
 * An expected failure with the HTTP status it maps to. Services throw these;
 * `errorHandler` turns them into `{ error }` responses.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = "Not authenticated") => new AppError(401, message);
export const forbidden = (message: string) => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Body parsers fail with a 4xx `status` (malformed JSON, body too large); pass those on.
  const status: number = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: status === 413 ? "Request is too large" : "Invalid request" });
};
