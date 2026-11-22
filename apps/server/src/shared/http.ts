import type { Request } from "express";
import type { z } from "zod";
import { SOCKET_ID_HEADER, type User } from "@pm/shared";
import { badRequest } from "./errors.js";

/** Validates input (a body or query) at the HTTP edge; throws 400 with the first issue. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

/** A positive integer route parameter; throws 400 with `message` otherwise. */
export function idParam(value: string | undefined, message: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest(message);
  return id;
}

/**
 * Who is making a request: the signed-in user, plus their realtime socket id (if sent),
 * so realtime events their request causes can skip the connection that already has the result.
 */
export interface Actor {
  user: User;
  socketId?: string;
}

/** The actor of a request that went through `requireAuth`. */
export const actorOf = (req: Request): Actor => ({ user: req.user!, socketId: req.get(SOCKET_ID_HEADER) });
