import { create } from "zustand";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const THEMES: Theme[] = ["system", "light", "dark"];

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : "system";
  } catch {
    return "system";
  }
}

/** "system" removes the attribute so the `prefers-color-scheme` media query decides. */
function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** system → light → dark → system */
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readStored(),

  setTheme: (theme) => {
    apply(theme);
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
    set({ theme });
  },

  cycle: () => {
    const next = THEMES[(THEMES.indexOf(get().theme) + 1) % THEMES.length];
    get().setTheme(next);
  },
}));

// index.html applies the stored theme before first paint; this keeps the store in sync.
apply(useTheme.getState().theme);
