import type { MessageDelivery, ReceiptStatus } from "@pm/shared";

export { deliveryOf } from "@pm/shared";

/** A saved message's receipt status, or the state of one still being sent from this client. */
export type DeliveryStatus = "sending" | "failed" | ReceiptStatus;

export interface DeliveryInfo extends Omit<MessageDelivery, "status"> {
  status: DeliveryStatus;
}
