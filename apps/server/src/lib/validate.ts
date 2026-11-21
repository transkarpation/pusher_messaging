import type { Response } from "express";
import type { z } from "zod";

/** Parses a request body (or query) with schema; on failure sends 400 and returns null. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "Invalid request" });
    return null;
  }
  return result.data;
}
