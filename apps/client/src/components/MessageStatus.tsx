import type { DeliveryInfo } from "../lib/delivery";

const plural = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function MessageStatus({ info, onRetry }: { info: DeliveryInfo; onRetry?: () => void }) {
  switch (info.status) {
    case "sending":
      return <span className="status" title="Sending…">🕓</span>;
    case "failed":
      return (
        <button type="button" className="status failed link" title="Not sent. Click to retry" onClick={onRetry}>
          ⚠ Retry
        </button>
      );
    case "sent":
      return <span className="status" title="Saved on the server">✓</span>;
    case "delivered":
      return (
        <span className="status" title={`Delivered to ${plural(info.deliveredCount)}`}>
          ✓✓
        </span>
      );
    case "read":
      return (
        <span
          className="status read"
          title={`Read by ${plural(info.readCount)} · delivered to ${plural(info.deliveredCount)}`}
        >
          ✓✓
        </span>
      );
  }
}
