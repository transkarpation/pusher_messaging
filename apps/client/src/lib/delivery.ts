import type { Message, Receipt } from "@pm/shared";

export type DeliveryStatus = "sending" | "failed" | "sent" | "delivered" | "read";

export interface DeliveryInfo {
  status: DeliveryStatus;
  deliveredCount: number;
  readCount: number;
}

/** Status of a persisted message, counted over everyone except its author. */
export function deliveryOf(message: Message, receipts: Record<number, Receipt>): DeliveryInfo {
  let deliveredCount = 0;
  let readCount = 0;
  for (const r of Object.values(receipts)) {
    if (r.userId === message.author.id) continue;
    if (r.deliveredUpTo >= message.id) deliveredCount++;
    if (r.readUpTo >= message.id) readCount++;
  }
  const status: DeliveryStatus = readCount > 0 ? "read" : deliveredCount > 0 ? "delivered" : "sent";
  return { status, deliveredCount, readCount };
}
