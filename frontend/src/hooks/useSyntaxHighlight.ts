import { useEffect, useState } from "react";

type HighlightMode = "fence" | "path";

type HighlightResult = {
  content: string;
  hint: string;
  mode: HighlightMode;
  language: string | null;
  highlighted: string | null;
};

export function useSyntaxHighlight(content: string, hint: string, mode: HighlightMode) {
  const [result, setResult] = useState<HighlightResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!content) return;

    void import("../utils/syntaxHighlight")
      .then((syntax) => {
        if (cancelled) return;
        const language =
          mode === "path" ? syntax.languageForPath(hint) : syntax.languageForCodeFence(hint);
        setResult({
          content,
          hint,
          mode,
          language,
          highlighted: syntax.highlightCode(content, language),
        });
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });

    return () => {
      cancelled = true;
    };
  }, [content, hint, mode]);

  const current =
    result?.content === content && result.hint === hint && result.mode === mode ? result : null;

  return {
    language: current?.language ?? null,
    highlighted: current?.highlighted ?? null,
  };
}
