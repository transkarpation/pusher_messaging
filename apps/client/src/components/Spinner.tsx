/** A small spinning ring; `label` is announced to screen readers. */
export function Spinner({ label, size = 20 }: { label: string; size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label={label} />;
}
