import { ChangeEvent, useCallback, useRef, useState } from "react";

export function useComposerInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resetComposer = useCallback(() => {
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, []);

  const restoreComposer = useCallback((text: string) => {
    setInput(text);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
      textarea.focus();
      textarea.setSelectionRange(text.length, text.length);
    });
  }, []);

  const onComposerInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 168)}px`;
  }, []);

  return { input, setInput, textareaRef, resetComposer, restoreComposer, onComposerInput };
}
