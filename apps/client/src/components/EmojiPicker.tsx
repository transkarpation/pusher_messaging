import { useEffect, useRef, useState } from "react";
import { EMOJI_CATEGORIES, pushRecentEmoji, readRecentEmojis } from "../lib/emoji";

/**
 * A button that opens a small emoji popover above the composer. Picking an emoji calls
 * `onPick` and keeps the popover open, so several can be added in a row.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecentEmojis);
  const [category, setCategory] = useState(() => (readRecentEmojis().length ? "recent" : EMOJI_CATEGORIES[0].id));
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Close on a click outside or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const tabs = [
    ...(recent.length ? [{ id: "recent", label: "Recently used", icon: "🕘", emojis: recent }] : []),
    ...EMOJI_CATEGORIES,
  ];
  const current = tabs.find((t) => t.id === category) ?? tabs[0];

  const pick = (emoji: string) => {
    onPick(emoji);
    setRecent(pushRecentEmoji(emoji));
  };

  return (
    <div className="emoji-picker" ref={rootRef}>
      <button
        type="button"
        className="ghost icon emoji-toggle"
        aria-label="Insert emoji"
        aria-expanded={open}
        title="Emoji"
        // Keep the focus (and caret) in the textarea.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        😊
      </button>
      {open && (
        <div className="emoji-popover" role="dialog" aria-label="Emoji" onMouseDown={(e) => e.preventDefault()}>
          <div className="emoji-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === current.id}
                className={`ghost emoji-tab ${t.id === current.id ? "active" : ""}`}
                title={t.label}
                aria-label={t.label}
                onClick={() => {
                  setCategory(t.id);
                  gridRef.current?.scrollTo({ top: 0 });
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <div className="emoji-grid" ref={gridRef} role="tabpanel" aria-label={current.label}>
            {current.emojis.map((e) => (
              <button key={e} type="button" className="ghost emoji-cell" onClick={() => pick(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
