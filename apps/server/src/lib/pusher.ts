import type { Request } from "express";
import Pusher from "pusher";
import { SOCKET_ID_HEADER } from "@pm/shared";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const pusherConfig = {
  appId: required("PUSHER_APP_ID"),
  key: required("PUSHER_KEY"),
  secret: required("PUSHER_SECRET"),
  cluster: required("PUSHER_CLUSTER"),
};

export const pusher = new Pusher({ ...pusherConfig, useTLS: true });

/**
 * Sends an event to a channel. When `req` carries the sender's socket id,
 * that connection is excluded. Failures are logged, never thrown: realtime is best-effort.
 */
export function broadcast(channel: string, event: string, data: unknown, req?: Request) {
  const socketId = req?.get(SOCKET_ID_HEADER);
  pusher
    .trigger(channel, event, data, socketId ? { socket_id: socketId } : undefined)
    .catch((err) => console.error(`Pusher trigger "${event}" on ${channel} failed:`, err));
}
