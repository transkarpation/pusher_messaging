import { useTheme, type Theme } from "../store/theme";

const ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme((s) => s.theme);
  const cycle = useTheme((s) => s.cycle);

  return (
    <button
      type="button"
      className={`ghost icon theme-toggle ${className}`}
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} (click to change)`}
      aria-label={`Theme: ${LABEL[theme]}. Click to change`}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
