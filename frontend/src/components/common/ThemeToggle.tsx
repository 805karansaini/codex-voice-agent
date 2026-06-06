import React from "react";
import { Sun, Moon } from "@phosphor-icons/react";

interface ThemeToggleProps {
  theme: "dark" | "light";
  onChange: (theme: "dark" | "light") => void;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onChange }) => {
  const toggle = () => {
    onChange(theme === "dark" ? "light" : "dark");
  };

  return (
    <button
      className="ghostBtn"
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {theme === "dark" ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
    </button>
  );
};
export default ThemeToggle;
