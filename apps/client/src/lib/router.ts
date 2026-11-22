import { useSyncExternalStore } from "react";

/** Client-side pages; anything else shows the chat. */
export const PROFILE_PATH = "/profile";
/** Demo accounts from the seed; reachable without signing in. */
export const SEEDS_PATH = "/seeds";

const NAVIGATE_EVENT = "pm:navigate";

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
};

/** The current URL path; re-renders on `navigate` and on browser back/forward. */
export const usePath = () => useSyncExternalStore(subscribe, () => window.location.pathname);

/** Goes to `path` (a history entry, so the browser's Back button returns). */
export function navigate(path: string, { replace = false } = {}) {
  if (window.location.pathname === path) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
