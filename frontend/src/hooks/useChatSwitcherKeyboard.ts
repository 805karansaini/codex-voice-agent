import { KeyboardEvent, useCallback } from "react";

export function useChatSwitcherKeyboard() {
  return useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-chat-switcher]"),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex === -1) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex - 1)
            : Math.min(buttons.length - 1, currentIndex + 1);
    buttons[nextIndex]?.focus();
  }, []);
}
