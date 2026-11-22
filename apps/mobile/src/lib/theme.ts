import { useColorScheme } from "react-native";

/** Light palette, the same as the web client's. */
const light = {
  bg: "#f5f5f7",
  card: "#ffffff",
  text: "#1d1d1f",
  muted: "#6e6e73",
  border: "#d2d2d7",
  accent: "#0a66ff",
  /** Text on `accent` (buttons, badges). */
  onAccent: "#ffffff",
  own: "#e8f0ff",
  bubble: "#f0f0f3",
  error: "#d70015",
};

export type Colors = typeof light;

/** Dark palette, the same as the web client's `prefers-color-scheme: dark` one. */
const dark: Colors = {
  bg: "#111113",
  card: "#1c1c1f",
  text: "#f5f5f7",
  muted: "#98989d",
  border: "#3a3a3c",
  accent: "#0a66ff",
  onAccent: "#ffffff",
  own: "#1a2a4a",
  bubble: "#2a2a2e",
  error: "#ff6961",
};

/** Whether the phone is in dark mode; follows the system setting as it changes. */
export const useIsDark = () => useColorScheme() === "dark";

/** The palette for the phone's current light/dark setting. */
export const useColors = (): Colors => (useIsDark() ? dark : light);

const cache = new WeakMap<object, Map<Colors, unknown>>();

/**
 * Styles built by `factory` for the current palette, e.g.
 * `const makeStyles = (c: Colors) => StyleSheet.create({ … })` at module level and
 * `const styles = useStyles(makeStyles)` in a component. Built once per palette.
 */
export function useStyles<T>(factory: (colors: Colors) => T): T {
  const colors = useColors();
  let byPalette = cache.get(factory);
  if (!byPalette) cache.set(factory, (byPalette = new Map()));
  if (!byPalette.has(colors)) byPalette.set(colors, factory(colors));
  return byPalette.get(colors) as T;
}
