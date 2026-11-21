import { useEffect, useState } from "react";

/** The user is looking at the app: tab visible and window focused. */
export const isWindowActive = () => document.visibilityState === "visible" && document.hasFocus();

export function useWindowActive() {
  const [active, setActive] = useState(isWindowActive);
  useEffect(() => {
    const update = () => setActive(isWindowActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);
  return active;
}
