import { useTheme } from "../store/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className={`ghost icon theme-toggle ${className}`}
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}
