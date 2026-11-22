import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** light ↔ dark */
  toggle: () => void;
}

// Until the user picks a theme, start from the OS preference. index.html leaves
// data-theme unset in that case, so the `prefers-color-scheme` CSS matches this value.
export const useTheme = create<ThemeState>((set, get) => ({
  theme: readStored() ?? systemTheme(),

  setTheme: (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
    set({ theme });
  },

  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
